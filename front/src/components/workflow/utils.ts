/**
 * Utility functions for Workflow component
 */

/**
 * Calculate the cursor position in a textarea for positioning selectors
 */
export const calculateCursorPosition = (
  textarea: HTMLTextAreaElement,
  textBeforeCursor: string
): { x: number; y: number } => {
  const textareaRect = textarea.getBoundingClientRect();
  const styles = window.getComputedStyle(textarea);
  
  // Create a mirror div to calculate position
  const mirror = document.createElement('div');
  
  // Copy styles
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = styles.whiteSpace || 'pre-wrap';
  mirror.style.wordWrap = styles.wordWrap || 'break-word';
  mirror.style.overflowWrap = styles.overflowWrap || 'break-word';
  mirror.style.font = styles.font;
  mirror.style.fontSize = styles.fontSize;
  mirror.style.fontFamily = styles.fontFamily;
  mirror.style.fontWeight = styles.fontWeight;
  mirror.style.fontStyle = styles.fontStyle;
  mirror.style.letterSpacing = styles.letterSpacing;
  mirror.style.padding = styles.padding;
  mirror.style.border = styles.border;
  mirror.style.width = `${textarea.offsetWidth}px`;
  mirror.style.boxSizing = styles.boxSizing;
  mirror.style.lineHeight = styles.lineHeight;
  mirror.style.wordSpacing = styles.wordSpacing;
  mirror.style.top = `${textareaRect.top}px`;
  mirror.style.left = `${textareaRect.left}px`;
  
  mirror.textContent = textBeforeCursor;
  document.body.appendChild(mirror);
  
  let cursorX: number;
  let cursorY: number;
  
  try {
    const range = document.createRange();
    const mirrorTextNode = mirror.firstChild;
    
    if (mirrorTextNode && mirrorTextNode.nodeType === Node.TEXT_NODE) {
      const textLength = mirrorTextNode.textContent?.length || 0;
      range.setStart(mirrorTextNode, textLength);
      range.setEnd(mirrorTextNode, textLength);
      const rangeRect = range.getBoundingClientRect();
      
      cursorX = rangeRect.right;
      cursorY = rangeRect.top;
      
      if (rangeRect.width === 0 && textLength > 0) {
        const measureSpan = document.createElement('span');
        measureSpan.style.font = styles.font;
        measureSpan.style.fontSize = styles.fontSize;
        measureSpan.style.fontFamily = styles.fontFamily;
        measureSpan.style.fontWeight = styles.fontWeight;
        measureSpan.style.fontStyle = styles.fontStyle;
        measureSpan.style.letterSpacing = styles.letterSpacing;
        measureSpan.style.whiteSpace = 'pre';
        measureSpan.textContent = textBeforeCursor;
        measureSpan.style.position = 'absolute';
        measureSpan.style.visibility = 'hidden';
        document.body.appendChild(measureSpan);
        const textWidth = measureSpan.offsetWidth;
        document.body.removeChild(measureSpan);
        
        const paddingLeft = parseFloat(styles.paddingLeft) || 0;
        cursorX = mirrorRect.left + paddingLeft + textWidth;
      }
    } else {
      throw new Error('No text node found');
    }
  } catch (e) {
    const mirrorRect = mirror.getBoundingClientRect();
    const lines = textBeforeCursor.split('\n');
    const lineIndex = lines.length - 1;
    const lineText = lines[lineIndex] || '';
    
    const lineMeasure = document.createElement('span');
    lineMeasure.style.font = styles.font;
    lineMeasure.style.fontSize = styles.fontSize;
    lineMeasure.style.fontFamily = styles.fontFamily;
    lineMeasure.style.fontWeight = styles.fontWeight;
    lineMeasure.style.fontStyle = styles.fontStyle;
    lineMeasure.style.letterSpacing = styles.letterSpacing;
    lineMeasure.style.whiteSpace = 'pre';
    lineMeasure.textContent = lineText;
    lineMeasure.style.position = 'absolute';
    lineMeasure.style.visibility = 'hidden';
    document.body.appendChild(lineMeasure);
    const lineWidth = lineMeasure.offsetWidth;
    document.body.removeChild(lineMeasure);
    
    const paddingLeft = parseFloat(styles.paddingLeft) || 0;
    const paddingTop = parseFloat(styles.paddingTop) || 0;
    const lineHeight = parseFloat(styles.lineHeight) || 20;
    
    cursorX = mirrorRect.left + paddingLeft + lineWidth;
    cursorY = mirrorRect.top + paddingTop + (lineIndex * lineHeight);
  }
  
  document.body.removeChild(mirror);
  
  return { x: cursorX, y: cursorY };
};
