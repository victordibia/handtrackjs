/**
 * @license
 * Copyright 2019 Victor Dibia.
 * Handtrack.js - A library for prototyping realtime hand tracking using neural networks.
 * Licensed under the MIT License (the "License");
 * Code snippets from the tensorflow coco-ssd example are reused here - https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd
 * =============================================================================
 */

import * as tf from "@tensorflow/tfjs";
import { loadGraphModel } from "@tensorflow/tfjs-converter";
// tf.setBackend("cpu");

// const basePath = "https://cdn.jsdelivr.net/npm/handtrackjs/models/web/";
const basePath = "webmodel/";

const defaultParams = {
  flipHorizontal: false,
  outputStride: 16,
  imageScaleFactor: 1,
  maxNumBoxes: 20,
  iouThreshold: 0.2,
  scoreThreshold: 0.7,
  modelType: "ssd320fpnlite",
  modelSize: "int8",
};

const labelMap = {
  1: "open",
  2: "closed",
  3: "pinch",
  4: "point",
  5: "face",
  6: "tip",
  7: "pinchtip",
};
const outputMapping = {
  int8: { classes: 6, boxes: 1, scores: 7 },
  fp16: { classes: 5, boxes: 0, scores: 6 },
  base: { classes: 1, boxes: 4, scores: 2 },
};

export async function load(params) {
  let modelParams = Object.assign({}, defaultParams, params);
  // console.log(modelParams)
  const objectDetection = new ObjectDetection(modelParams);
  await objectDetection.load();
  return objectDetection;
}

export function startVideo(video) {
  // Video must have height and width in order to be used as input for NN
  // Aspect ratio of 3/4 is used to support safari browser.
  video.width = video.width || 640;
  video.height = video.height || video.width * (3 / 4);

  return new Promise(function (resolve, reject) {
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
        },
      })
      .then((stream) => {
        window.localStream = stream;
        video.srcObject = stream;
        video.onloadedmetadata = () => {
          video.play();
          resolve(true);
        };
      })
      .catch(function (err) {
        resolve(false);
      });
  });
}

export async function stopVideo() {
  if (window.localStream) {
    window.localStream.getTracks().forEach((track) => {
      track.stop();
      return true;
    });
  } else {
    return false;
  }
}

export class ObjectDetection {
  constructor(modelParams) {
    this.modelPath =
      basePath +
      modelParams.modelType +
      "/" +
      modelParams.modelSize +
      "/model.json ";
    // this.weightPath =
    //   basePath + modelParams.modelType + "/weights_manifest.json";
    this.modelParams = modelParams;
  }

  async load() {
    this.fps = 0;
    // this.model = await tf.loadFrozenModel(this.modelPath, this.weightPath);
    this.model = await loadGraphModel(this.modelPath);
    // Warmup the model.
    const result = await this.model.executeAsync(
      tf.zeros([1, 300, 300, 3], "int32")
    );
    result.map(async (t) => await t.data());
    result.map(async (t) => t.dispose());
    console.log("model loaded and warmed up");
    // console.log(tf.memory());
  }

  async detect(input) {
    let timeBegin = Date.now();
    const [height, width] = getInputTensorDimensions(input);
    const resizedHeight = getValidResolution(
      this.modelParams.imageScaleFactor,
      height,
      this.modelParams.outputStride
    );
    const resizedWidth = getValidResolution(
      this.modelParams.imageScaleFactor,
      width,
      this.modelParams.outputStride
    );

    const batched = tf.tidy(() => {
      const imageTensor = tf.browser.fromPixels(input);
      if (this.modelParams.flipHorizontal) {
        return (
          imageTensor
            //   .transpose([0, 1, 2])
            .reverse(1)
            .resizeBilinear([resizedHeight, resizedWidth])
            .expandDims(0)
            .toInt()
        );
      } else {
        return (
          imageTensor
            //   .transpose([0, 1, 2])
            .resizeBilinear([resizedHeight, resizedWidth])
            .expandDims(0)
            .toInt()
        );
      }
    });
    // const result = await this.model.executeAsync(batched);
    const self = this;
    const om = outputMapping[this.modelParams.modelSize];
    return this.model.executeAsync(batched).then(function (result) {
      const classes = result[om.classes].dataSync();
      const boxes = result[om.boxes].arraySync();
      const scores = result[om.scores].arraySync();

      //   console.log(scores.length, boxes.length);
      //   for (let i = 0; i < result.length; i++) {
      //     console.log(i, "=>", result[i].shape, result[i].dataSync().slice(0, 2));
      //   }
      //   console.log(result);
      // clean the webgl tensors
      batched.dispose();
      tf.dispose(result);

      const predictions = self.buildDetectedObjects(
        scores,
        self.modelParams.scoreThreshold,
        boxes,
        classes,
        width,
        height
      );

      let timeEnd = Date.now();
      self.fps = Math.round(1000 / (timeEnd - timeBegin));

      return predictions;
    });
  }

  buildDetectedObjects(scores, threshold, boxes, classes, width, height) {
    const detectionObjects = [];
    scores[0].forEach((score, i) => {
      if (score > threshold) {
        const bbox = [];
        const minY = boxes[0][i][0] * height;
        const minX = boxes[0][i][1] * width;
        const maxY = boxes[0][i][2] * height;
        const maxX = boxes[0][i][3] * width;
        bbox[0] = minX;
        bbox[1] = minY;
        bbox[2] = maxX - minX;
        bbox[3] = maxY - minY;
        detectionObjects.push({
          class: Math.round(classes[i]),
          label: labelMap[Math.round(classes[i])],
          score: score.toFixed(4),
          bbox: bbox,
        });
      }
    });
    return detectionObjects;
  }

  getFPS() {
    return this.fps;
  }

  setModelParameters(params) {
    this.modelParams = Object.assign({}, this.modelParams, params);
  }

  getModelParameters() {
    return this.modelParams;
  }

  renderPredictions(predictions, canvas, context, mediasource) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = mediasource.width;
    canvas.height = mediasource.height;
    // console.log("render", mediasource.width, mediasource.height)

    context.save();
    if (this.modelParams.flipHorizontal) {
      context.scale(-1, 1);
      context.translate(-mediasource.width, 0);
    }
    context.drawImage(mediasource, 0, 0, mediasource.width, mediasource.height);
    context.restore();
    context.font = "10px Arial";

    // console.log('number of detections: ', predictions.length);
    for (let i = 0; i < predictions.length; i++) {
      context.beginPath();
      context.fillStyle = "rgba(255, 255, 255, 0.6)";

      context.fillRect(
        predictions[i].bbox[0],
        predictions[i].bbox[1] - 17,
        predictions[i].bbox[2],
        17
      );
      //   context.lineWidth = "10";
      context.rect(...predictions[i].bbox);

      // draw a dot at the center of bounding box

      context.lineWidth = 1;
      context.strokeStyle = "#0063FF";
      context.fillStyle = "#0063FF"; // "rgba(244,247,251,1)";
      context.fillRect(
        predictions[i].bbox[0] + predictions[i].bbox[2] / 2,
        predictions[i].bbox[1] + predictions[i].bbox[3] / 2,
        5,
        5
      );

      context.stroke();
      context.fillText(
        predictions[i].score + " " + " | " + predictions[i].label,
        predictions[i].bbox[0] + 5,
        predictions[i].bbox[1] > 10 ? predictions[i].bbox[1] - 5 : 10
      );
    }

    // Write FPS to top left
    context.font = "bold 16px Arial";
    // context.fillText("[FPS]: " + this.fps, 10, 20);
  }

  dispose() {
    if (this.model) {
      this.model.dispose();
    }
  }
}

function getValidResolution(imageScaleFactor, inputDimension, outputStride) {
  const evenResolution = inputDimension * imageScaleFactor - 1;
  return evenResolution - (evenResolution % outputStride) + 1;
}

function getInputTensorDimensions(input) {
  return input instanceof tf.Tensor
    ? [input.shape[0], input.shape[1]]
    : [input.height, input.width];
}

function calculateMaxScores(scores, numBoxes, numClasses) {
  const maxes = [];
  const classes = [];
  for (let i = 0; i < numBoxes; i++) {
    let max = Number.MIN_VALUE;
    let index = -1;
    for (let j = 0; j < numClasses; j++) {
      if (scores[i * numClasses + j] > max) {
        max = scores[i * numClasses + j];
        index = j;
      }
    }
    maxes[i] = max;
    classes[i] = index;
  }
  // console.log([maxes, classes])
  return [maxes, classes];
}