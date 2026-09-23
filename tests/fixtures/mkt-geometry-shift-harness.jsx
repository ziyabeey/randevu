import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { useVideoScrollScrub } from '../../src/marketing/transformation/useVideoScrollScrub';

const DURATION = 5.041667;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function settleBrowser() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await sleep(80);
}

function createDeterministicMedia() {
  let currentTime = 0;
  return {
    readyState: HTMLMediaElement.HAVE_METADATA,
    duration: DURATION,
    currentTime,
    paused: true,
    autoplay: false,
    preload: 'metadata',
    pause() {},
    addEventListener() {},
    removeEventListener() {},
    get _currentTime() { return currentTime; },
    set _currentTime(value) { currentTime = value; },
  };
}

function GeometryShiftHarness() {
  const sectionRef = useRef(null);
  const mediaRef = useRef(null);
  const spacerRef = useRef(null);
  const [status, setStatus] = useState('pending');
  const [detail, setDetail] = useState('waiting for scrub hook');

  if (mediaRef.current === null) {
    const media = createDeterministicMedia();
    Object.defineProperty(media, 'currentTime', {
      configurable: true,
      get: () => media._currentTime,
      set: (value) => {
        media._currentTime = Math.min(DURATION, Math.max(0, Number(value) || 0));
      },
    });
    mediaRef.current = media;
  }

  const { metadataReady } = useVideoScrollScrub(sectionRef, mediaRef, false);

  useEffect(() => {
    if (!metadataReady) return undefined;

    let cancelled = false;

    const run = async () => {
      const section = sectionRef.current;
      const video = mediaRef.current;
      const spacer = spacerRef.current;
      if (!section || !video || !spacer) {
        setStatus('fail');
        setDetail('missing harness node');
        return;
      }

      const scrollToProgress = (progress) => {
        const liveTop = window.scrollY + section.getBoundingClientRect().top;
        const range = Math.max(1, section.offsetHeight - window.innerHeight);
        window.scrollTo(0, liveTop + (range * progress));
      };

      await settleBrowser();
      if (cancelled) return;

      scrollToProgress(0.5);
      await settleBrowser();
      if (cancelled) return;

      const expectedTime = DURATION * 0.5;
      const before = video.currentTime;

      spacer.style.height = '720px';
      await settleBrowser();
      if (cancelled) return;

      scrollToProgress(0.5);
      await settleBrowser();
      if (cancelled) return;

      const after = video.currentTime;
      const cssProgress = Number(section.style.getPropertyValue('--mkt-progress'));
      const passed = Math.abs(before - expectedTime) < 0.22
        && Math.abs(after - expectedTime) < 0.22
        && Math.abs(cssProgress - 0.5) < 0.035;

      setDetail(`before=${before.toFixed(4)} after=${after.toFixed(4)} progress=${cssProgress.toFixed(4)}`);
      setStatus(passed ? 'pass' : 'fail');
    };

    void run();
    return () => { cancelled = true; };
  }, [metadataReady]);

  return (
    <main style={{ margin: 0, minHeight: '3720px', overflowAnchor: 'none' }}>
      <div ref={spacerRef} id="mkt-geometry-spacer" style={{ height: '120px' }} />
      <section
        ref={sectionRef}
        className="mkt-transformation"
        style={{ height: '3600px', position: 'relative' }}
      >
        <div style={{ position: 'sticky', top: 0, height: '100vh' }} />
      </section>
      <output id="mkt-geometry-result" data-status={status} data-detail={detail}>{status}</output>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<GeometryShiftHarness />);
