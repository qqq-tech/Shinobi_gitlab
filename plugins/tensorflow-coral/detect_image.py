# Lint as: python3
# Copyright 2019 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Example using TF Lite to detect objects in a given image."""

import argparse
import time
import sys
from PIL import Image
from PIL import ImageDraw
from io import BytesIO, StringIO
import time
import base64
import json
from pycoral.adapters import common
from pycoral.adapters import detect
from pycoral.utils.dataset import read_label_file
from pycoral.utils.edgetpu import make_interpreter
import platform


def load_labels(path, encoding='utf-8'):
    """Loads labels from file (with or without index numbers).

    Args:
      path: path to label file.
      encoding: label file encoding.
    Returns:
      Dictionary mapping indices to labels.
    """
    with open(path, 'r', encoding=encoding) as f:
        lines = f.readlines()
        if not lines:
            return {}

        if lines[0].split(' ', maxsplit=1)[0].isdigit():
            pairs = [line.split(' ', maxsplit=1) for line in lines]
            return {int(index): label.strip() for index, label in pairs}
        else:
            return {index: line.strip() for index, line in enumerate(lines)}


def draw_objects(draw, objs, labels):
    """Draws the bounding box and label for each object."""
    for obj in objs:
        bbox = obj.bbox
        draw.rectangle([(bbox.xmin, bbox.ymin), (bbox.xmax, bbox.ymax)],
                       outline='red')
        draw.text((bbox.xmin + 10, bbox.ymin + 10),
                  '%s\n%.2f' % (labels.get(obj.id, obj.id), obj.score),
                  fill='red')


def printInfo(text):
    print(json.dumps({"type": "info", "data": text}))


def printError(text):
    print(json.dumps({"type": "error", "data": text}))


def printData(array, time):
    print(json.dumps({"type": "data", "data": array, "time": time}))


def main():
    labels = read_label_file("models/coco_labels.txt")

    interpreter = make_interpreter(
        "models/ssd_mobilenet_v2_coco_quant_postprocess_edgetpu.tflite")
    interpreter.allocate_tensors()
    threshold = 0.4
    printInfo("ready")
    while True:
        line = sys.stdin.readline().rstrip("\n")
        try:
            rawImage = BytesIO(base64.b64decode(line))
            image = Image.open(rawImage)
            _, scale = common.set_resized_input(
                interpreter, image.size, lambda size: image.resize(size, Image.ANTIALIAS))

            start = time.perf_counter()
            interpreter.invoke()
            inference_time = time.perf_counter() - start
            objs = detect.get_objects(interpreter, threshold, scale)
            output = []
            for obj in objs:
                label = labels.get(obj.id, obj.id)
                labelID = obj.id
                score = obj.score
                bbox = obj.bbox
                output.append({"bbox": bbox, "class": label, "score": score})
            printData(output, (inference_time * 1000))
        except Exception as e:
            printError(str(e))


if __name__ == '__main__':
    main()
