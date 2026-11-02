# make_icons.py
# -----------------------------------------------------------------------------
# Draws the extension's icon (a white briefcase on a blue rounded square) and
# saves it as PNG files in the icons/ folder at the sizes Chrome uses:
# 16, 32, 48 and 128 pixels.
#
# This script is NOT part of the extension itself. Chrome never runs it. You
# only need it if you want to change the icon's design or colours.
#
# How to run it (from the project folder, in Terminal):
#
#     python3 tools/make_icons.py
#
# It uses only Python's built-in modules, so there's nothing to install.
# Afterwards, reload the extension on chrome://extensions to see the change.
#
# How it works, in short:
#   1. The design is a list of simple shapes (rounded rectangles) described in
#      a 0-to-1 coordinate space, so the same design works at any size.
#      (0, 0) is the top-left corner and (1, 1) is the bottom-right.
#   2. For each pixel we test many points inside it ("supersampling") and mix
#      their colours. This smooths the edges (anti-aliasing).
#   3. We write the pixels out in the PNG file format by hand.
# -----------------------------------------------------------------------------

import os
import struct
import sys
import zlib

# --- Colours (red, green, blue), each from 0 to 255 ---------------------------
# BLUE matches the accent colour used for buttons in styles.css (#2f6fde).
BLUE = (47, 111, 222)
WHITE = (255, 255, 255)

# The icon sizes Chrome uses, in pixels.
SIZES = (16, 32, 48, 128)


def in_rounded_rect(x, y, left, top, right, bottom, radius):
    """Return True if the point (x, y) is inside a rectangle with rounded corners."""
    # Quick check: outside the plain rectangle means definitely outside.
    if x < left or x > right or y < top or y > bottom:
        return False
    # Find the nearest point on the rectangle shrunk by the corner radius.
    # If (x, y) is within "radius" of that point, it's inside the shape.
    # This is what rounds off the corners.
    nearest_x = min(max(x, left + radius), right - radius)
    nearest_y = min(max(y, top + radius), bottom - radius)
    return (x - nearest_x) ** 2 + (y - nearest_y) ** 2 <= radius * radius


def colour_at(x, y):
    """Return the colour at point (x, y), or None if it's transparent.

    Shapes are painted in order, like layers in a drawing app: a later shape
    covers an earlier one wherever they overlap.
    """
    colour = None  # None = transparent (nothing drawn here)

    # Layer 1: the blue rounded-square background.
    if in_rounded_rect(x, y, 0.02, 0.02, 0.98, 0.98, 0.22):
        colour = BLUE

    # Layer 2: the handle, a white ring on top of the case.
    # It's a rounded rectangle with a smaller one cut out of its middle.
    outer = in_rounded_rect(x, y, 0.36, 0.20, 0.64, 0.40, 0.07)
    hole = in_rounded_rect(x, y, 0.43, 0.27, 0.57, 0.40, 0.02)
    if outer and not hole:
        colour = WHITE

    # Layer 3: the main body of the briefcase.
    if in_rounded_rect(x, y, 0.18, 0.33, 0.82, 0.80, 0.08):
        colour = WHITE

    # Layer 4: a thin blue line across the body, where the lid meets the case.
    if 0.18 <= x <= 0.82 and 0.50 <= y <= 0.555:
        colour = BLUE

    # Layer 5: a small white clasp sitting over that line.
    if in_rounded_rect(x, y, 0.44, 0.46, 0.56, 0.595, 0.025):
        colour = WHITE

    return colour


def render_png(size, samples=8, padding=0):
    """Draw the icon at "size" x "size" pixels and return it as PNG bytes.

    "samples" is how many test points per pixel we use in each direction
    (8 x 8 = 64 points). More points = smoother edges but slower.

    "padding" is an empty, see-through border in pixels on every side. The
    design is shrunk to fit inside it.
    """
    # How much of the image the design covers, from 0 to 1.
    scale = (size - 2 * padding) / size
    rows = []
    for py in range(size):
        # Each PNG row starts with a "filter type" byte. 0 means "no filter".
        row = bytearray([0])
        for px in range(size):
            red = green = blue = hits = 0
            # Test a grid of points spread evenly inside this pixel.
            for sy in range(samples):
                for sx in range(samples):
                    # Position in the image, then shifted and stretched so
                    # the design sits inside the padding.
                    x = ((px + (sx + 0.5) / samples) / size - padding / size) / scale
                    y = ((py + (sy + 0.5) / samples) / size - padding / size) / scale
                    c = colour_at(x, y)
                    if c:
                        red += c[0]
                        green += c[1]
                        blue += c[2]
                        hits += 1
            if hits:
                # Colour = average of the points that hit a shape.
                # Opacity (alpha) = the share of points that hit anything,
                # so edge pixels come out partly see-through and look smooth.
                alpha = 255 * hits // (samples * samples)
                row += bytes([red // hits, green // hits, blue // hits, alpha])
            else:
                row += bytes([0, 0, 0, 0])  # fully transparent
        rows.append(bytes(row))

    # --- Write the PNG file format ---------------------------------------------
    # A PNG is a fixed 8-byte signature followed by "chunks". Each chunk is:
    # length, 4-letter type, data, and a checksum (CRC) of the type + data.
    def chunk(chunk_type, data):
        checksum = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", checksum)

    signature = b"\x89PNG\r\n\x1a\n"
    # IHDR = image header: width, height, 8 bits per channel,
    # colour type 6 (red, green, blue + alpha), then three settings left at 0.
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    # IDAT = the pixel data, compressed with zlib.
    pixels = zlib.compress(b"".join(rows), 9)
    # IEND marks the end of the file.
    return signature + chunk(b"IHDR", header) + chunk(b"IDAT", pixels) + chunk(b"IEND", b"")


def main():
    # Default output folder: "icons" next to this "tools" folder. You can pass
    # a different folder as an argument: python3 tools/make_icons.py some/folder
    script_folder = os.path.dirname(os.path.abspath(__file__))
    default_folder = os.path.join(script_folder, "..", "icons")
    out_folder = sys.argv[1] if len(sys.argv) > 1 else default_folder
    os.makedirs(out_folder, exist_ok=True)

    for size in SIZES:
        path = os.path.join(out_folder, f"icon{size}.png")
        with open(path, "wb") as f:  # "wb" = write binary data
            f.write(render_png(size))
        print("Wrote", os.path.normpath(path))

    # The Chrome Web Store icon: 128 x 128 pixels, with the design 96 x 96 in
    # the middle and 16 pixels of empty space on every side, as the store asks.
    # It goes in store-assets/, not icons/, because Chrome itself doesn't use it.
    store_folder = os.path.join(script_folder, "..", "store-assets")
    os.makedirs(store_folder, exist_ok=True)
    path = os.path.join(store_folder, "store-icon-128.png")
    with open(path, "wb") as f:
        f.write(render_png(128, padding=16))
    print("Wrote", os.path.normpath(path))


# Only run main() when this file is run directly (not when it's imported).
if __name__ == "__main__":
    main()
