from PIL import Image, ImageDraw, ImageFont
import os

def add_label(image_path, text):
    """
    Adds a text label to the bottom of the image.
    Overwrites the image at image_path.
    """
    try:
        img = Image.open(image_path)
        
        # Calculate font size based on image width
        width, height = img.size
        font_size = int(width * 0.05) # 5% of width
        
        # specific font for macOS to support Japanese
        font_path = "/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc"
        if not os.path.exists(font_path):
            font_path = "/System/Library/Fonts/Hiragino Sans GB.ttc"
        
        try:
            font = ImageFont.truetype(font_path, font_size)
        except OSError:
            # Fallback
            font = ImageFont.load_default()
            print("Warning: Japanese font not found, using default.")

        draw = ImageDraw.Draw(img)
        
        # text size
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        
        # Position: centered at bottom with some padding
        x = (width - text_w) / 2
        y = height - text_h - (height * 0.02)
        
        # Optional: Add a semi-transparent background for text or outline?
        # For simplicity, let's just draw white text with black outline for visibility
        
        # Outline
        outline_color = "black"
        text_color = "white"
        stroke_width = max(1, int(font_size / 10))
        
        draw.text((x, y), text, font=font, fill=text_color, stroke_width=stroke_width, stroke_fill=outline_color)
        
        exif_data = img.info.get('exif')
        if exif_data:
            img.save(image_path, exif=exif_data)
        else:
            img.save(image_path)
        return True
    
    except Exception as e:
        print(f"Error labeling {image_path}: {e}")
        return False
