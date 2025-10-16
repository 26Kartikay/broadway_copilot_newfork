import sys
import json
import requests
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont

def load_image_from_url(url):
    resp = requests.get(url)
    resp.raise_for_status()
    return Image.open(BytesIO(resp.content)).convert("RGBA")

def load_image_from_path_or_url(path_or_url):
    if path_or_url.startswith('http'):
        return load_image_from_url(path_or_url)
    else:
        return Image.open(path_or_url).convert("RGBA")

def main():
    if len(sys.argv) != 3:
        print("Usage: generate_image.py input_json_path output_path")
        sys.exit(1)

    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        data = json.load(f)
    output_path = sys.argv[2]

    # Get template URL and load image as background
    template_url = data.get('template_url')
    if not template_url:
        print("Missing template_url in input data")
        sys.exit(1)

    image = load_image_from_url(template_url)

    user_image_path = data.get('user_image_path')
    if user_image_path:
        user_img = load_image_from_path_or_url(user_image_path).resize((250, 250))
        image.paste(user_img, (40, 40))

    # (Continue with remaining drawing/text logic as needed...)


    image.save(output_path)

if __name__ == "__main__":
    main()
