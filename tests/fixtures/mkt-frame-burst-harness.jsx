import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { useFrameSequenceScrollScrub } from '../../src/marketing/transformation/useFrameSequenceScrollScrub';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function FrameBurstHarness() {
  const sectionRef = useRef(null);
  const canvasRef = useRef(null);
  const { phase, frameReady, failed, variant } = useFrameSequenceScrollScrub(sectionRef, canvasRef, false);
  const [receipt, setReceipt] = useState({ status: 'pending' });

  useEffect(() => {
    if (!frameReady || failed || receipt.status !== 'pending') return undefined;

    let cancelled = false;

    const run = async () => {
      const section = sectionRef.current;
      if (!section) {
        setReceipt({ status: 'fail', detail: 'missing section' });
        return;
      }

      const scrollTo = (progress) => {
        const top = window.scrollY + section.getBoundingClientRect().top;
        const range = Math.max(1, section.offsetHeight - window.innerHeight);
        window.scrollTo(0, top + (range * progress));
      };

      for (const progress of [0.92, 0.15, 0.78, 0.25, 0.88, 0.2]) {
        scrollTo(progress);
        await sleep(12);
        if (cancelled) return;
      }

      const deadline = performance.now() + 5_000;
      let snapshot = null;
      while (performance.now() < deadline) {
        const frameIndex = Number(section.dataset.frameIndex ?? -1);
        const phaseName = section.dataset.phase ?? '';
        if (Math.abs(frameIndex - 24) <= 1 && phaseName === 'reminder') {
          snapshot = {
            status: 'pass',
            frameIndex,
            phase: phaseName,
            cachePeak: Number(section.dataset.frameCachePeak ?? 0),
            staleCount: Number(section.dataset.frameStaleCount ?? 0),
            failureCount: Number(section.dataset.frameFailureCount ?? 0),
            requestCount: Number(section.dataset.frameRequestCount ?? 0),
            compressedBytes: Number(section.dataset.frameCompressedBytes ?? 0),
            firstDrawMs: Number(section.dataset.frameFirstDrawMs ?? 0),
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
          };
          break;
        }
        await sleep(40);
        if (cancelled) return;
      }

      if (!snapshot) {
        snapshot = {
          status: 'fail',
          frameIndex: Number(section.dataset.frameIndex ?? -1),
          phase: section.dataset.phase ?? '',
          cachePeak: Number(section.dataset.frameCachePeak ?? 0),
          staleCount: Number(section.dataset.frameStaleCount ?? 0),
          failureCount: Number(section.dataset.frameFailureCount ?? 0),
          requestCount: Number(section.dataset.frameRequestCount ?? 0),
          compressedBytes: Number(section.dataset.frameCompressedBytes ?? 0),
          firstDrawMs: Number(section.dataset.frameFirstDrawMs ?? 0),
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        };
      }

      if (!cancelled) setReceipt(snapshot);
    };

    void run();
    return () => { cancelled = true; };
  }, [failed, frameReady, receipt.status]);

  return (
    <main style={{ margin: 0, minHeight: '3600px', overflowAnchor: 'none' }}>
      <section
        ref={sectionRef}
        className="mkt-transformation"
        data-phase={phase}
        data-frame-ready={frameReady ? 'true' : 'false'}
        data-frame-failed={failed ? 'true' : 'false'}
        data-frame-variant={variant}
        style={{ height: '3600px', position: 'relative' }}
      >
        <div style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'hidden' }}>
          <canvas ref={canvasRef} className="mkt-transformation-frame-canvas" style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>
      </section>
      <output
        id="mkt-frame-burst-result"
        data-status={receipt.status}
        data-variant={variant}
        data-frame-index={receipt.frameIndex ?? -1}
        data-phase={receipt.phase ?? ''}
        data-cache-peak={receipt.cachePeak ?? 0}
        data-stale-count={receipt.staleCount ?? 0}
        data-failure-count={receipt.failureCount ?? 0}
        data-request-count={receipt.requestCount ?? 0}
        data-compressed-bytes={receipt.compressedBytes ?? 0}
        data-first-draw-ms={receipt.firstDrawMs ?? 0}
        data-client-width={receipt.clientWidth ?? 0}
        data-scroll-width={receipt.scrollWidth ?? 0}
      >{receipt.status}</output>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<FrameBurstHarness />);
