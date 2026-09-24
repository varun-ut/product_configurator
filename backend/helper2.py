from PIL import Image

input_path = "diamond.png"
output_path = "output.png"

img = Image.open(input_path).convert("RGBA")
pixels = img.getdata()

new_pixels = []

# threshold for "white"
threshold = 240

for pixel in pixels:
    r, g, b, a = pixel

    # if pixel is near white
    if r > threshold and g > threshold and b > threshold:
        new_pixels.append((255, 255, 255, 0))  # transparent
    else:
        new_pixels.append((r, g, b, a))  # keep original

img.putdata(new_pixels)
img.save(output_path)

print("Background removed → saved as", output_path)