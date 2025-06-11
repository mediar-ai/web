'use client';

import React from 'react';

interface VideoPreviewAreaProps {
  stream: MediaStream | null;
  videoRef: (node: HTMLVideoElement | null) => void;
}

const VideoPreviewArea: React.FC<VideoPreviewAreaProps> = ({ stream, videoRef }) => {
  return (
    <div className="relative w-full aspect-video bg-gray-900 rounded-lg overflow-hidden border">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-contain"
      />
      {!stream && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-50">
          <p className="text-white text-lg font-semibold">
            Screen Share Preview
          </p>
          <p className="text-gray-300">
            Start screen sharing to see the preview here.
          </p>
        </div>
      )}
    </div>
  );
};

export default VideoPreviewArea; 