interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number; disallowReturnToOpener?: boolean }): Promise<Window>;
}

interface Window {
  documentPictureInPicture?: DocumentPictureInPicture;
} 