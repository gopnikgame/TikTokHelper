import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NeuralTtsExperiment } from './NeuralTtsExperiment.js';

describe('NeuralTtsExperiment', () => {
  it('keeps model downloads disabled while a live session is active', () => {
    const html = renderToStaticMarkup(<NeuralTtsExperiment liveActive />);
    expect(html).toContain('Эксперимент для администра');
    expect(html).toContain('сначала остановите эфир');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
