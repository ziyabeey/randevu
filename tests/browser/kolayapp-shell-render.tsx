import { renderToStaticMarkup } from 'react-dom/server';
import { KolayAppSpikePreview } from '../../src/kolayapp/index';

export const markup = renderToStaticMarkup(<KolayAppSpikePreview />);
