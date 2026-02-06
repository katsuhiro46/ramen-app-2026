from PIL import Image, ImageDraw, ImageFont
import os


def add_label(image_path, text):
    """
    画像の下部に店名ラベルを追加する
    - フォントサイズ: 画像高さの15%（看板レベルの巨大サイズ）
    - 極太縁取り（ストローク）
    - 半透明の黒背景バーで視認性を極限まで向上
    """
    try:
        img = Image.open(image_path)
        width, height = img.size

        # EXIF データを先に取得（後で保存時に使用）
        exif_data = img.info.get('exif')

        # フォントサイズ: 画像高さの15%（看板のように巨大）
        font_size = int(height * 0.15)
        if font_size < 48:
            font_size = 48

        # フォント探索（複数パス対応: macOS + Linux/Vercel）
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

        # 半透明背景バーの領域計算
        bar_pad = int(height * 0.018)
        bar_extra = int(font_size * 0.4)
        bar_height = text_h + bar_pad * 2 + bar_extra
        bar_y = height - bar_height

        # RGBA に変換して半透明オーバーレイ合成
        if img.mode != 'RGBA':
            img = img.convert('RGBA')

        overlay = Image.new('RGBA', (width, height), (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        # グラデーション風の半透明黒バー（不透明度67%）
        overlay_draw.rectangle(
            [(0, bar_y), (width, height)],
            fill=(0, 0, 0, 170)
        )
        img = Image.alpha_composite(img, overlay)

        # テキスト描画: 太い縁取り + 白文字
        draw = ImageDraw.Draw(img)
        x = (width - text_w) / 2
        y = bar_y + bar_pad + int(bar_extra * 0.25)

        # 極太の黒縁（看板のように目立たせる）
        stroke_w = max(6, int(font_size / 3))
        draw.text(
            (x, y), text, font=font,
            fill=(255, 255, 255, 255),
            stroke_width=stroke_w,
            stroke_fill=(0, 0, 0, 255)
        )

        # RGB に戻して JPEG 保存
        img = img.convert('RGB')
        save_kwargs = {'format': 'JPEG', 'quality': 95}
        if exif_data:
            save_kwargs['exif'] = exif_data
        img.save(image_path, **save_kwargs)

        return True

    except Exception as e:
        print(f"Error labeling {image_path}: {e}")
        return False
