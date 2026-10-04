from PIL import Image

# --- settings ---
tile_path = "tile.png"       # your small tileable PNG
output_path = "pattern.png"
canvas_size = 3000           # final size (3000x3000)

# --- load tile ---
tile = Image.open(tile_path).convert("RGBA")
tile_w, tile_h = tile.size

# --- create transparent canvas ---
canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))

# --- repeat tile ---
for x in range(0, canvas_size, tile_w):
    for y in range(0, canvas_size, tile_h):
        canvas.paste(tile, (x, y), tile)

# --- crop exactly 3000x3000 (safety) ---
canvas = canvas.crop((0, 0, canvas_size, canvas_size))

# --- save result ---
canvas.save(output_path)

print("Pattern saved as", output_path)