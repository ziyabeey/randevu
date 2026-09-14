import React, { useRef } from 'react';
import { createRoot } from 'react-dom/client';

import { useFrameSequenceScrollScrub } from '../../src/marketing/transformation/useFrameSequenceScrollScrub';

function FrameSequenceHarness() {
  const sectionRef = useRef(null);
  const canvasRef = useRef(null);
  const disabled = new URLSearchParams(window.location.search).get('reduced') === '1';
  const { phase, frameReady, failed, variant } = useFrameSequenceScrollScrub(sectionRef, canvasRef, disabled);

  return (
    <main style={{ margin: 0, minHeight: '3600px', overflow: 'clip' }}>
      <section
        ref={sectionRef}
        className="mkt-transformation"
        data-phase={phase}
        data-frame-ready={frameReady ? 'true' : 'false'}
        data-frame-failed={failed ? 'true' : 'false'}
        data-frame-variant={variant}
        style={{ height: '3600px', position: 'relative' }}
      >
        <div style={{ position: 'sticky', top: 0, width: '100%', height: '100vh', overflow: 'hidden' }}>
          <canvas
            ref={canvasRef}
            className="mkt-transformation-frame-canvas"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
          />
          <output id="mkt-frame-phase">{phase}</output>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<FrameSequenceHarness />);
