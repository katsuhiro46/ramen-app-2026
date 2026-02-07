from PIL import Image, ImageDraw, ImageFont
import os


def add_label(image_path, text):
    """
    画像の下部に店名ラベルを追加する（goal.jpg完全再現版）
    - フォントサイズ: 画像高さの15%
    - 太い白文字 + 極太黒縁取り（5px以上）
    - 半透明バーなし（テキスト直接配置）
    """
    try:
        img = Image.open(image_path)
        width, height = img.size

        # EXIF データを先に取得
        exif_data = img.info.get('exif')

        # フォントサイズ: 画像高さの15%（goal.jpg完全再現）
        font_size = int(height * 0.15)
        if font_size < 48:
            font_size = 48

        # フォント探索（macOS + Linux/Vercel）
        font_paths = [
            "/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc",
            "/System/Library/Fonts/Hiragino Sans GB.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
            "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ]

        font = None
        for fp in font_paths:
            if os.path.exists(fp):
                try:
                    font = ImageFont.truetype(fp, font_size)
                    break
                except OSError:
                    continue
        if font is None:
            try:
                font = ImageFont.truetype("DejaVuSans-Bold.ttf", font_size)
            except OSError:
                font = ImageFont.load_default()
                print("Warning: No suitable font found, using default.")

        # テキストサイズ計算
        temp_draw = ImageDraw.Draw(img)
        bbox = temp_draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]

        # テキスト位置: 画像下部中央（goal.jpgと同じ配置）
        x = (width - text_w) / 2
        y = height - text_h - int(height * 0.02)  # 下から2%のマージン

        # RGBモードで描画（半透明バーなし）
        if img.mode != 'RGB':
            img = img.convert('RGB')

        draw = ImageDraw.Draw(img)

        # 極太の黒縁取り + 白文字（5px以上の太縁）
        stroke_w = max(5, int(font_size / 3))
        draw.text(
            (x, y), text, font=font,
            fill=(255, 255, 255),
            stroke_width=stroke_w,
            stroke_fill=(0, 0, 0)
        )

        # JPEG 保存
        save_kwargs = {'format': 'JPEG', 'quality': 95}
        if exif_data:
            save_kwargs['exif'] = exif_data
        img.save(image_path, **save_kwargs)

        print(f"✅ ラベル追加完了: {text} (font={font_size}px, stroke={stroke_w}px)")
        return True

    except Exception as e:
        print(f"Error labeling {image_path}: {e}")
        return False
