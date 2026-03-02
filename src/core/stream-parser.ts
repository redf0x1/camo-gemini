import { ANTI_XSSI_PREFIX } from "./constants.js";

export interface FrameParseResult {
  frames: unknown[];
  remainder: string;
}

export class StreamParser {
  extractFrames(rawResponse: string): unknown[] {
    let content = rawResponse;
    if (content.startsWith(ANTI_XSSI_PREFIX)) {
      content = content.slice(ANTI_XSSI_PREFIX.length);
    }
    content = content.trimStart();

    const { frames } = this.parseFrameBuffer(content);
    if (frames.length > 0) {
      return frames;
    }

    try {
      const parsed = JSON.parse(content.trim()) as unknown;
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  }

  parseFrameBuffer(content: string): FrameParseResult {
    const frames: unknown[] = [];
    let consumedPos = 0;
    const lengthMarkerPattern = /(\d+)/y;

    while (consumedPos < content.length) {
      while (consumedPos < content.length && /\s/.test(content[consumedPos])) {
        consumedPos += 1;
      }

      if (consumedPos >= content.length) {
        break;
      }

      lengthMarkerPattern.lastIndex = consumedPos;
      const match = lengthMarkerPattern.exec(content);
      if (!match) {
        break;
      }

      const lengthValue = match[1];
      const length = Number.parseInt(lengthValue, 10);
      const startContent = match.index + lengthValue.length;
      const endContent = startContent + length;

      if (endContent > content.length) {
        consumedPos = match.index;
        break;
      }

      const chunk = content.slice(startContent, endContent).trim();
      consumedPos = endContent;

      if (!chunk) {
        continue;
      }

      try {
        const parsed = JSON.parse(chunk) as unknown;
        if (Array.isArray(parsed)) {
          frames.push(...parsed);
        } else {
          frames.push(parsed);
        }
      } catch {
        continue;
      }
    }

    return {
      frames,
      remainder: content.slice(consumedPos)
    };
  }
}
