import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export const MAX_UPLOAD_EDGE = 2560;

export interface Photo {
  uri: string;
  width: number;
  height: number;
}

/**
 * Every photo is re-encoded as a JPEG no larger than 2560 px before upload. That keeps uploads quick on mobile
 * data, turns HEIC into something the API accepts, and drops EXIF, including any embedded GPS position.
 */
export async function prepareForUpload(photo: Photo): Promise<Photo> {
  const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(photo.width, photo.height));
  const context = ImageManipulator.manipulate(photo.uri);
  if (scale < 1) {
    context.resize(
      photo.width >= photo.height
        ? { width: Math.round(photo.width * scale) }
        : { height: Math.round(photo.height * scale) }
    );
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.88, format: SaveFormat.JPEG });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}
