import os
import glob
from pathlib import Path

def get_input_photos(input_dir: str):
    """
    Scans the input directory for image files (jpg, jpeg, png).
    Returns a list of Path objects.
    """
    extensions = ['*.jpg', '*.jpeg', '*.JPG', '*.JPEG', '*.png', '*.PNG']
    files = []
    for ext in extensions:
        files.extend(glob.glob(os.path.join(input_dir, ext)))
    
    return [Path(f) for f in files]
