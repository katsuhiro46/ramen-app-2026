"""
GPS座標抽出モジュール - 完全版
PillowでEXIFからGPS座標を確実に抽出（Pillow 10.0+対応）
"""
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS, IFD
import subprocess
import json
import re


def get_decimal_from_dms(dms, ref):
    """
    度分秒 (DMS) を10進数の度に変換
    複数のEXIF形式に対応
    """
    try:
        values = []
        for v in dms:
            # IFDRational型
            if hasattr(v, 'numerator'):
                values.append(float(v.numerator) / float(v.denominator) if v.denominator != 0 else float(v.numerator))
            # 通常の数値
            else:
                values.append(float(v))
        
        degrees, minutes, seconds = values[0], values[1], values[2]
        decimal = degrees + (minutes / 60.0) + (seconds / 3600.0)
        
        if ref in ['S', 'W']:
            decimal = -decimal
        
        return decimal
    except Exception as e:
        print(f"DMS conversion error: {e}, dms={dms}")
        return None


def get_gps_from_exif_ifd(img):
    """
    Pillow 10.0+ のIFD方式でGPSを取得
    """
    try:
        exif = img.getexif()
        if not exif:
            return None
        
        # IFD.GPSInfo から取得
        gps_ifd = exif.get_ifd(IFD.GPSInfo)
        if not gps_ifd:
            print("No GPS IFD found")
            return None
        
        print(f"GPS IFD keys: {list(gps_ifd.keys())}")
        
        # タグをデコード
        gps_info = {}
        for tag, value in gps_ifd.items():
            decoded = GPSTAGS.get(tag, tag)
            gps_info[decoded] = value
        
        print(f"Decoded GPS: {gps_info}")
        
        if 'GPSLatitude' in gps_info and 'GPSLongitude' in gps_info:
            lat_ref = gps_info.get('GPSLatitudeRef', 'N')
            lon_ref = gps_info.get('GPSLongitudeRef', 'E')
            
            lat = get_decimal_from_dms(gps_info['GPSLatitude'], lat_ref)
            lon = get_decimal_from_dms(gps_info['GPSLongitude'], lon_ref)
            
            if lat and lon:
                return lat, lon
        
        return None
    except Exception as e:
        print(f"IFD GPS extraction error: {e}")
        return None


def get_gps_from_legacy_exif(img):
    """
    従来の_getexif()方式でGPSを取得
    """
    try:
        exif_data = img._getexif()
        if not exif_data:
            return None
        
        # GPSInfo タグ (34853) を探す
        gps_tag = 34853
        if gps_tag not in exif_data:
            # タグ名で探す
            for tag, value in exif_data.items():
                if TAGS.get(tag) == 'GPSInfo':
                    gps_raw = value
                    break
            else:
                return None
        else:
            gps_raw = exif_data[gps_tag]
        
        print(f"Legacy GPS raw type: {type(gps_raw)}")
        
        # GPSInfoをデコード
        gps_info = {}
        if isinstance(gps_raw, dict):
            for key, value in gps_raw.items():
                decoded = GPSTAGS.get(key, key)
                gps_info[decoded] = value
        
        if 'GPSLatitude' in gps_info and 'GPSLongitude' in gps_info:
            lat_ref = gps_info.get('GPSLatitudeRef', 'N')
            lon_ref = gps_info.get('GPSLongitudeRef', 'E')
            
            lat = get_decimal_from_dms(gps_info['GPSLatitude'], lat_ref)
            lon = get_decimal_from_dms(gps_info['GPSLongitude'], lon_ref)
            
            if lat and lon:
                return lat, lon
        
        return None
    except Exception as e:
        print(f"Legacy GPS extraction error: {e}")
        return None


def get_gps_from_sips(image_path):
    """
    macOS sipsコマンドでGPSを取得（フォールバック）
    """
    try:
        result = subprocess.run(
            ['sips', '-g', 'allxml', image_path],
            capture_output=True, text=True, timeout=10
        )
        
        output = result.stdout
        
        # 緯度を探す
        lat_match = re.search(r'<key>latitude</key>\s*<real>([+-]?\d+\.?\d*)</real>', output)
        lon_match = re.search(r'<key>longitude</key>\s*<real>([+-]?\d+\.?\d*)</real>', output)
        
        if lat_match and lon_match:
            lat = float(lat_match.group(1))
            lon = float(lon_match.group(1))
            print(f"SIPS GPS: lat={lat}, lon={lon}")
            return lat, lon
        
        return None
    except Exception as e:
        print(f"SIPS GPS error: {e}")
        return None


def get_gps_from_mdls(image_path):
    """
    macOS mdlsコマンドでGPSを取得（フォールバック2）
    """
    try:
        result = subprocess.run(
            ['mdls', '-name', 'kMDItemLatitude', '-name', 'kMDItemLongitude', image_path],
            capture_output=True, text=True, timeout=10
        )
        
        output = result.stdout
        
        lat_match = re.search(r'kMDItemLatitude\s*=\s*([+-]?\d+\.?\d*)', output)
        lon_match = re.search(r'kMDItemLongitude\s*=\s*([+-]?\d+\.?\d*)', output)
        
        if lat_match and lon_match:
            lat = float(lat_match.group(1))
            lon = float(lon_match.group(1))
            print(f"MDLS GPS: lat={lat}, lon={lon}")
            return lat, lon
        
        return None
    except Exception as e:
        print(f"MDLS GPS error: {e}")
        return None


def get_exif_data(image_path):
    """
    画像からEXIFデータを抽出（互換性用）
    """
    try:
        img = Image.open(image_path)
        exif = img.getexif()
        
        if exif:
            result = {}
            for tag, value in exif.items():
                decoded = TAGS.get(tag, tag)
                result[decoded] = value
            
            # GPSInfo IFDも含める
            try:
                gps_ifd = exif.get_ifd(IFD.GPSInfo)
                if gps_ifd:
                    result['GPSInfo'] = gps_ifd
            except:
                pass
            
            return result
        
        return None
    except Exception as e:
        print(f"EXIF extraction error: {e}")
        return None


def get_gps_info(exif):
    """
    EXIFからGPS座標を抽出（完全版）
    複数の方法を試行
    """
    # この関数はexifを受け取るが、実際の処理はget_gps_coordinates()で行う
    # 互換性のために残す
    if not exif:
        return None
    
    if 'GPSInfo' in exif:
        gps_raw = exif['GPSInfo']
        gps_info = {}
        
        if isinstance(gps_raw, dict):
            for key, value in gps_raw.items():
                decoded = GPSTAGS.get(key, key)
                gps_info[decoded] = value
        
        if 'GPSLatitude' in gps_info and 'GPSLongitude' in gps_info:
            lat_ref = gps_info.get('GPSLatitudeRef', 'N')
            lon_ref = gps_info.get('GPSLongitudeRef', 'E')
            
            lat = get_decimal_from_dms(gps_info['GPSLatitude'], lat_ref)
            lon = get_decimal_from_dms(gps_info['GPSLongitude'], lon_ref)
            
            if lat and lon:
                return lat, lon
    
    return None


def get_gps_coordinates(image_path):
    """
    画像からGPS座標を確実に取得（メイン関数）
    複数の方法を順番に試行
    """
    print(f"=== GPS Extraction: {image_path} ===")
    
    try:
        img = Image.open(image_path)
        
        # 方法1: Pillow 10.0+ IFD方式
        print("Trying IFD method...")
        result = get_gps_from_exif_ifd(img)
        if result:
            print(f"✅ IFD method success: {result}")
            return result
        
        # 方法2: 従来の_getexif()方式
        print("Trying legacy method...")
        result = get_gps_from_legacy_exif(img)
        if result:
            print(f"✅ Legacy method success: {result}")
            return result
        
    except Exception as e:
        print(f"Pillow methods failed: {e}")
    
    # 方法3: macOS sipsコマンド
    print("Trying SIPS method...")
    result = get_gps_from_sips(image_path)
    if result:
        print(f"✅ SIPS method success: {result}")
        return result
    
    # 方法4: macOS mdlsコマンド
    print("Trying MDLS method...")
    result = get_gps_from_mdls(image_path)
    if result:
        print(f"✅ MDLS method success: {result}")
        return result
    
    print("❌ All GPS extraction methods failed")
    return None


def get_shop_name(lat, lon):
    """
    座標から店名を取得
    飲食店が見つからない場合はNoneを返す（住所は返さない）
    """
    from geopy.geocoders import Nominatim
    from geopy.exc import GeocoderTimedOut
    
    geolocator = Nominatim(user_agent="RamenFactory_v4")
    
    try:
        print(f"Reverse geocoding: {lat}, {lon}")
        location = geolocator.reverse((lat, lon), exactly_one=True, language='ja')
        
        if location:
            address = location.raw.get('address', {})
            print(f"Address: {address}")
            
            # 店名キーのみを探す（住所は使わない）
            shop_keys = ['restaurant', 'cafe', 'fast_food']
            for key in shop_keys:
                if key in address and address[key]:
                    shop_name = address[key]
                    print(f"Found shop: {shop_name}")
                    return shop_name
            
            # 飲食店が見つからない場合はNoneを返す
            print("No restaurant found at this location")
            return None
            
    except Exception as e:
        print(f"Geocoding error: {e}")
    
    return None
