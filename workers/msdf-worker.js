(function () {
    "use strict";

    // Regular expressions for detecting line breaks and whitespace
    const newlineRegex = /\n/;
    const whitespaceRegex = /[ \t]/;

    // Function to calculate kerning (spacing between specific character pairs)
    function calculateKerning(font, unicode1, unicode2) {
        for (let i = 0; i < font.kerning.length; i++) {
            const kerningPair = font.kerning[i];
            if (kerningPair.unicode1 === unicode1 && kerningPair.unicode2 === unicode2) {
                return kerningPair.advance;
            }
        }
        return 0; // Default kerning value if no pair is found
    }

    // Handle messages from the main thread
    onmessage = (event) => {
        const { font, options } = event.data;

        // Extract text layout options
        let text = options.text || "";
        const maxWidth = options.width || Infinity;
        const alignment = options.align || "left";
        const fontSize = options.size || 1;
        const letterSpacing = options.letterSpacing || 0;
        const lineHeight = options.lineHeight || 1.4;
        const wordSpacing = options.wordSpacing || 0;
        const wordBreak = options.wordBreak || false;
        const baseOffset = options.baseOffset || 0;
        const isBreakable = options.isBreakable || false; 
        const breakAfterWords = options.breakAfterWords || 0; 
        const maxBreaks = options.maxBreaks || 1; 
        const isTab = options.isTab || false
        const tabAfterWords = options.tabAfterWord || []
        const tabSpacings = options.tabSpacings || []
        const isCap = options.isCap || false;
        const capScale = options.capScale || 1.2
        const isWordCap = options.isWordCap || false
        const wordCapScale = options.wordCapScale || 0.5
        let appliedBreaks = 0;

        if(isTab && tabAfterWords.length !== tabSpacings.length){
            console.error("you must specify the spacing for each tab")
        }

        // Scaling factor to normalize font size
        const scale = fontSize / font.metrics.lineHeight;

        // Replace non-breaking spaces with regular spaces
        text = text.replace(/\xA0/g, " ");

        // Count visible characters (non-whitespace)
        const visibleCharCount = text.replace(/[ \n]/g, "").length;

        // Prepare data buffers for the layout result
        const buffers = {
            index: new Uint16Array(visibleCharCount * 6), // Indices for triangles
            position: new Float32Array(visibleCharCount * 4 * 3), // Vertex positions
            uv: new Float32Array(visibleCharCount * 4 * 2), // UV coordinates
            centr: new Float32Array(visibleCharCount * 4 * 3), // Center positions
            uvMask: new Float32Array(visibleCharCount * 4 * 4), // UV masks
            textWeights: new Float32Array(visibleCharCount * 4 * 2), // Text weights
            lineWeights: new Float32Array(visibleCharCount * 4 * 3), // Line weights
            maxLineHeight: -Infinity, // Maximum line height
            maxUVDisp: -Infinity, // Maximum UV displacement
        };

        // Initialize indices for triangles (every glyph has 2 triangles)
        for (let i = 0; i < visibleCharCount; i++) {
            buffers.index.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
        }

        // A structure to hold lines of text
        const lines = [];
        let currentCharIndex = 0;
        let currentLineStart = 0;
        let currentWordWidth = 0;
        let wordCount = 0;
        let globalWordCount = 0;

        // Helper function to create a new line
        function createNewLine() {
            const line = {
                width: 0,
                glyphs: [], // Glyphs in this line
            };
            lines.push(line);
            currentLineStart = currentCharIndex;
            currentWordWidth = 0;
            wordCount = 0;
            return line;
        }

        // Initialize the first line
        let currentLine = createNewLine();
        let isFirstWord = true

        // Helper function to count words in a line
        function countWords(glyphs) {
            return glyphs.reduce((count, [glyph]) => count + (glyph.isWhitespace ? 1 : 0), 0);
        }
        

        // Process the text character by character
        while (currentCharIndex < text.length) {
            let char = text[currentCharIndex];

            if (!currentLine.width && whitespaceRegex.test(char)) {
                currentCharIndex++;
                currentLineStart = currentCharIndex;
                currentWordWidth = 0;
                wordCount = 0;
                continue;
            }

            // Handle line breaks
            if (newlineRegex.test(char)) {
                if (currentLine.glyphs.length > 0) {
                    const lastGlyph = currentLine.glyphs[currentLine.glyphs.length - 1][0];
                    if (lastGlyph.isWhitespace) {
                        // Subtract the extra space caused by the whitespace glyph from the width
                        currentLine.width -= wordSpacing * fontSize + lastGlyph.advance * scale;
                    }
                }
                currentLine.glyphs.pop();
                currentLine = createNewLine();
                currentCharIndex++;
                continue;
            }

            let adjustedScale = scale;
            if (isCap && currentCharIndex === 0) {
                adjustedScale *= capScale;
            }

            if (isWordCap && !whitespaceRegex.test(char)) {
                adjustedScale *= isFirstWord ? 1 : wordCapScale;
            }

            let glyph = font.glyphs[char];
            if (!glyph) {
                char = font.placeholderChar;
                glyph = font.glyphs[char];
            }

            // Add kerning if applicable
            if (currentLine.glyphs.length > 0) {
                const previousGlyph = currentLine.glyphs[currentLine.glyphs.length - 1][0];
                const kerning = calculateKerning(font, glyph.unicode, previousGlyph.unicode) * adjustedScale;
                currentLine.width += kerning;
                currentWordWidth += kerning;
            }

            // Add the glyph to the current line
            currentLine.glyphs.push([glyph, currentLine.width,adjustedScale]);
            



            let spacing = 0;
            if (glyph.isWhitespace) {
                // Handle whitespace: reset word tracking and add word spacing
                currentLineStart = currentCharIndex; // Update the position of the last whitespace
                currentWordWidth = 0; // Reset the current word width
                spacing += wordSpacing * fontSize; // Add word spacing
                wordCount++;
                globalWordCount++
                isFirstWord = false;
            } else {
                // Handle regular characters: add letter spacing
                spacing += letterSpacing * fontSize;
            }

            // Add the character's advance width (scaled) to the current width
            spacing += glyph.advance * adjustedScale;

            // Update the total line width and current word width
            currentLine.width += spacing;
            currentWordWidth += spacing;

            // Check if we should break the line based on `isBreakable` and `breakAfterWords`
            const wordsInLine = countWords(currentLine.glyphs);
            if (
                appliedBreaks < maxBreaks &&
                isBreakable &&
                wordsInLine >= breakAfterWords
            ) {
                // Apply explicit break after the specified number of words
                appliedBreaks++;
                currentLine = createNewLine();
            } else if (
                !isBreakable &&
                currentLine.width > maxWidth
            ) {

                if (wordBreak && currentLine.glyphs.length > 1) {
                    currentLine.width -= spacing,
                    currentLine.glyphs.pop(),
                    currentLine = createNewLine();
                    continue
                } else if (!wordBreak && currentWordWidth !== currentLine.width) {
                    const h = currentCharIndex - currentLineStart + 1;
                    currentLine.glyphs.splice(-h, h),
                    currentCharIndex = currentLineStart,
                    currentLine.width -= currentWordWidth,
                    currentLine = createNewLine();
                    continue
                }
            }

            if (isTab && tabAfterWords.includes(globalWordCount)) { 
                const tabIndex = tabAfterWords.indexOf(globalWordCount);
                const tabSpacing = tabSpacings[tabIndex] || 0.1; // Adjust as needed for the desired tab width
                currentLine.width += tabSpacing; // Add spacing to the line width
                currentWordWidth += tabSpacing; // Include in the current word width
            
                // Shift the entire word by applying the tab offset
                for (let i = currentLine.glyphs.length - 1; i >= 0; i--) {
                    const [glyph, xOffset] = currentLine.glyphs[i];
                    if (glyph.isWhitespace) break; // Stop adjusting when encountering whitespace
                    currentLine.glyphs[i][1] += tabSpacing; // Apply tab offset to each glyph's position
                }
            }
            

            // Move to the next character
            currentCharIndex++;
        }

        // Remove the last line if it's empty
        if (!currentLine.width) {
            lines.pop();
        }


        // Font atlas dimensions
        const atlasWidth = font.atlas.width;
        const atlasHeight = font.atlas.height;
        
        let currentYOffset = baseOffset * fontSize; // Initial Y offset
        let glyphIndex = 0; // Overall glyph index
        let whitespaceCount = -1; // Total whitespace count
        let lineCount = -1; // Total line count
        
        const lastLineIndex = lines.length - 1;
        const whitespacePerLine = [];
        
        // Analyze lines and whitespace distribution
        lines.forEach((line) => {
            whitespaceCount += line.glyphs.length;
            lineCount++;
            let whitespacesInLine = 0;
        
            line.glyphs.forEach(([glyph]) => {
                if (glyph.isWhitespace) {
                    lineCount++;
                    whitespacesInLine++;
                }
            });
        
            whitespacePerLine.push(whitespacesInLine);
        });
        
        // Precompute normalization factors
        const glyphWeightFactor = whitespaceCount < 1 ? 0 : 1 / whitespaceCount;
        const whitespaceWeightFactor = lineCount < 1 ? 0 : 1 / lineCount;
        const lineWeightFactor = lastLineIndex < 1 ? 0 : 1 / lastLineIndex;
        
        const glyphWeightPerLine = lines.map(line => {
            const glyphCount = line.glyphs.length - 1;
            return glyphCount < 1 ? 0 : 1 / glyphCount;
        });
        
        const whitespaceWeightPerLine = whitespacePerLine.map(whitespaces => {
            return whitespaces < 1 ? 0 : 1 / whitespaces;
        });
        
        let globalGlyphIndex = -1;
        let whitespaceGlobalIndex = 0;
        
        // Iterate through each line and process its glyphs
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const lineWeight = lineIndex * lineWeightFactor;
        
            for (let glyphIndexInLine = 0, whitespaceIndexInLine = 0; glyphIndexInLine < line.glyphs.length; glyphIndexInLine++) {
                const [glyph, glyphXOffset,glyphScale] = line.glyphs[glyphIndexInLine];
                let adjustedXOffset = glyphXOffset;
        
                // Adjust X position based on alignment
                if (alignment === "center") {
                    adjustedXOffset -= line.width * 0.5;
                } else if (alignment === "right") {
                    adjustedXOffset -= line.width;
                }
        
                globalGlyphIndex++;
                if (glyph.isWhitespace) {
                    whitespaceGlobalIndex++;
                    whitespaceIndexInLine++;
                    continue;
                }
        
                // Glyph bounds in plane space
                const bottom = glyph.planeBounds.bottom * glyphScale;
                const left = glyph.planeBounds.left * glyphScale;
                const right = glyph.planeBounds.right * glyphScale;
                const top = glyph.planeBounds.top * glyphScale;
        
                // Position buffer
                buffers.position.set([
                    adjustedXOffset + left, currentYOffset + bottom, 0,
                    adjustedXOffset + left, currentYOffset + top, 0,
                    adjustedXOffset + right, currentYOffset + bottom, 0,
                    adjustedXOffset + right, currentYOffset + top, 0
                ], glyphIndex * 4 * 3);
        
                // Update max line height
                buffers.maxLineHeight = Math.max(buffers.maxLineHeight, Math.abs(top) + Math.abs(bottom));
        
                // Center positions
                const centerX = adjustedXOffset + left + (Math.abs(left) + Math.abs(right)) * 0.5;
                const centerY = currentYOffset + bottom + (Math.abs(bottom) + Math.abs(top)) * 0.5;
                buffers.centr.set([centerX, centerY, 0, centerX, centerY, 0, centerX, centerY, 0, centerX, centerY, 0], glyphIndex * 4 * 3);
        
                // UV coordinates
                const uvLeft = glyph.atlasBounds.left / atlasWidth;
                const uvRight = glyph.atlasBounds.right / atlasWidth;
                const uvBottom = glyph.atlasBounds.bottom / atlasHeight;
                const uvTop = glyph.atlasBounds.top / atlasHeight;
                buffers.uv.set([uvLeft, uvBottom, uvLeft, uvTop, uvRight, uvBottom, uvRight, uvTop], glyphIndex * 4 * 2);
                buffers.maxUVDisp = Math.max(buffers.maxUVDisp, Math.max(uvRight - uvLeft, uvTop - uvBottom));
        
                // UV mask
                const maskData = [uvLeft, uvRight, uvBottom, uvTop];
                buffers.uvMask.set([...maskData, ...maskData, ...maskData, ...maskData], glyphIndex * 4 * 4);
        
                // Text weights
                const glyphWeight = globalGlyphIndex * glyphWeightFactor;
                const whitespaceWeight = whitespaceGlobalIndex * whitespaceWeightFactor;
                buffers.textWeights.set([glyphWeight, whitespaceWeight, glyphWeight, whitespaceWeight, glyphWeight, whitespaceWeight, glyphWeight, whitespaceWeight], glyphIndex * 4 * 2);
        
                // Line weights
                const localGlyphWeight = glyphWeightPerLine[lineIndex] * glyphIndexInLine;
                const localWhitespaceWeight = whitespaceWeightPerLine[lineIndex] * whitespaceIndexInLine;
                buffers.lineWeights.set([localGlyphWeight, localWhitespaceWeight, lineWeight, localGlyphWeight, localWhitespaceWeight, lineWeight, localGlyphWeight, localWhitespaceWeight, lineWeight, localGlyphWeight, localWhitespaceWeight, lineWeight], glyphIndex * 4 * 3);
        
                glyphIndex++;
            }
        
            whitespaceGlobalIndex++;
            currentYOffset -= fontSize * lineHeight; // Update Y offset for next line
        }
        

        // Transfer results back to the main thread
        const transferableBuffers = [];
        Object.keys(buffers).forEach(key => {
            if (buffers[key].buffer) {
                transferableBuffers.push(buffers[key].buffer);
            }
        });

        postMessage({
            buffers,
        }, transferableBuffers);
    };
})();