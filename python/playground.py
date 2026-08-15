import PIL

import io
import numpy as np
from PIL import Image

image = Image.open("mandelbrot.png")
np_array = np.array(image)

pil_image=Image.fromarray(np_array)

imgByteArr = io.BytesIO()
pil_image.save(imgByteArr, "png")

image.save(imgByteArr, format=image.format)
imgByteArr = imgByteArr.getvalue()