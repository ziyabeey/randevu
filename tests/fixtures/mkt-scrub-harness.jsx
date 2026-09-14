import React, { useLayoutEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';

import { useVideoScrollScrub } from '../../src/marketing/transformation/useVideoScrollScrub';

const DURATION = 5.041667;

function ScrubHarness() {
  const sectionRef = useRef(null);
  const videoRef = useRef(null);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let currentTime = 0;

    Object.defineProperties(video, {
      readyState: {
        configurable: true,
        get: () => HTMLMediaElement.HAVE_METADATA,
      },
      duration: {
        configurable: true,
        get: () => DURATION,
      },
      currentTime: {
        configurable: true,
        get: () => currentTime,
        set: (value) => {
          currentTime = Math.min(DURATION, Math.max(0, Number(value) || 0));
        },
      },
      paused: {
        configurable: true,
        get: () => true,
      },
      autoplay: {
        configurable: true,
        get: () => false,
      },
    });

    video.pause = () => {};
    video.load = () => {};
    video.preload = 'auto';
  }, []);

  const { phase, metadataReady } = useVideoScrollScrub(sectionRef, videoRef, false);

  return (
    <main style={{ margin: 0, minHeight: '3600px' }}>
      <section
        ref={sectionRef}
        className="mkt-transformation"
        data-phase={phase}
        data-metadata-ready={metadataReady ? 'true' : 'false'}
        style={{ height: '3600px', position: 'relative' }}
      >
        <div style={{ position: 'sticky', top: 0, height: '100vh' }}>
          <video ref={videoRef} className="mkt-transformation-video" muted playsInline />
          <output id="mkt-scrub-phase">{phase}</output>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<ScrubHarness />);
