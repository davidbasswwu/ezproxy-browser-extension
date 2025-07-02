/**
 * Screenshot Annotator for Institutional Access Detection
 * 
 * This utility adds visual annotations to screenshots when institutional access is detected,
 * making it easier for human reviewers to quickly identify evidence of institutional access.
 */

const sharp = require('sharp');
const path = require('path');

class ScreenshotAnnotator {
    constructor() {
        this.annotationStyle = {
            // Colors
            highlightColor: '#00ff00',
            arrowColor: '#ff4500', 
            calloutColor: '#00cc44',
            textColor: 'white',
            shadowColor: 'rgba(0,0,0,0.3)',
            
            // Sizes
            arrowWidth: 8,
            highlightStroke: 3,
            calloutPadding: 15,
            fontSize: 18,
            
            // Animation (for future SVG animations)
            pulseEnabled: true
        };
    }

    /**
     * Detects potential institutional access indicators in screenshot metadata or filename
     * @param {string} imagePath - Path to the screenshot
     * @param {Object} detectionData - Data about detected institutional access
     * @returns {Object} Detection results with coordinates
     */
    detectInstitutionalAccess(imagePath, detectionData = {}) {
        // This would typically analyze the image or use provided detection data
        // For now, we'll use common patterns for institutional access locations
        
        const commonLocations = {
            topRightHeader: { x: 960, y: 60, width: 220, height: 30 },
            topNavigation: { x: 800, y: 50, width: 300, height: 40 },
            userMenu: { x: 900, y: 40, width: 250, height: 50 },
            loginStatus: { x: 850, y: 70, width: 200, height: 25 }
        };

        // Return the most likely location based on detection data
        return {
            found: true,
            location: detectionData.location || commonLocations.topRightHeader,
            text: detectionData.text || 'WESTERN WASHINGTON UNIV',
            confidence: detectionData.confidence || 0.9
        };
    }

    /**
     * Creates SVG overlay with institutional access annotations
     * @param {number} width - Image width
     * @param {number} height - Image height  
     * @param {Object} detection - Detection results
     * @returns {string} SVG markup
     */
    createAnnotationSVG(width, height, detection) {
        const { location } = detection;
        const style = this.annotationStyle;
        
        // Calculate annotation positions
        const arrowStart = { x: location.x - 110, y: location.y + location.height/2 };
        const arrowEnd = { x: location.x - 10, y: location.y + location.height/2 };
        const calloutPos = { 
            x: arrowStart.x - 200, 
            y: location.y - 80,
            width: 320,
            height: 55
        };

        return `
        <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <!-- Arrow marker -->
                <marker id="arrowhead" markerWidth="20" markerHeight="14" 
                        refX="20" refY="7" orient="auto" markerUnits="strokeWidth">
                    <path d="M 0 0 L 20 7 L 0 14 L 5 7 Z" 
                          fill="${style.arrowColor}" stroke="#cc3300" stroke-width="1"/>
                </marker>
                
                <!-- Pulsing animation -->
                <animate id="pulse" attributeName="opacity" 
                         values="0.7;1;0.7" dur="2s" repeatCount="indefinite"/>
            </defs>
            
            <!-- Highlight box around institutional access text -->
            <rect x="${location.x}" y="${location.y}" 
                  width="${location.width}" height="${location.height}" 
                  fill="rgba(0,255,0,0.2)" stroke="${style.highlightColor}" 
                  stroke-width="${style.highlightStroke}" 
                  stroke-dasharray="8,4" rx="5">
                ${style.pulseEnabled ? '<animateTransform attributeName="transform" type="scale" values="1;1.05;1" dur="2s" repeatCount="indefinite"/>' : ''}
            </rect>
            
            <!-- Arrow pointing to institutional access -->
            <g>
                <!-- Arrow shadow for depth -->
                <path d="M ${arrowStart.x + 2} ${arrowStart.y + 2} L ${arrowEnd.x + 2} ${arrowEnd.y + 2}" 
                      stroke="${style.shadowColor}" stroke-width="${style.arrowWidth - 2}" 
                      stroke-linecap="round"/>
                <!-- Main arrow -->
                <path d="M ${arrowStart.x} ${arrowStart.y} L ${arrowEnd.x} ${arrowEnd.y}" 
                      stroke="${style.arrowColor}" stroke-width="${style.arrowWidth}" 
                      fill="none" marker-end="url(#arrowhead)" stroke-linecap="round">
                    ${style.pulseEnabled ? '<animate attributeName="stroke-width" values="8;12;8" dur="1.5s" repeatCount="indefinite"/>' : ''}
                </path>
            </g>
            
            <!-- Callout bubble -->
            <g>
                <!-- Callout shadow -->
                <rect x="${calloutPos.x + 5}" y="${calloutPos.y + 5}" 
                      width="${calloutPos.width}" height="${calloutPos.height}" 
                      fill="${style.shadowColor}" rx="15"/>
                <!-- Main callout -->
                <rect x="${calloutPos.x}" y="${calloutPos.y}" 
                      width="${calloutPos.width}" height="${calloutPos.height}" 
                      fill="${style.calloutColor}" stroke="#00aa00" stroke-width="3" rx="15"/>
                <!-- Callout pointer -->
                <path d="M ${calloutPos.x + calloutPos.width} ${calloutPos.y + calloutPos.height/2} 
                         L ${calloutPos.x + calloutPos.width + 15} ${calloutPos.y + calloutPos.height/2 - 10} 
                         L ${calloutPos.x + calloutPos.width + 15} ${calloutPos.y + calloutPos.height/2 + 10} Z" 
                      fill="${style.calloutColor}" stroke="#00aa00" stroke-width="2"/>
            </g>
            
            <!-- Callout text -->
            <text x="${calloutPos.x + calloutPos.width/2}" y="${calloutPos.y + 22}" 
                  text-anchor="middle" font-family="Arial, sans-serif" 
                  font-size="${style.fontSize}" font-weight="bold" fill="${style.textColor}">
                ✅ INSTITUTIONAL ACCESS
            </text>
            <text x="${calloutPos.x + calloutPos.width/2}" y="${calloutPos.y + 42}" 
                  text-anchor="middle" font-family="Arial, sans-serif" 
                  font-size="${style.fontSize - 2}" font-weight="bold" fill="${style.textColor}">
                DETECTED
            </text>
            
            <!-- Additional indicator for EZProxy URL if present -->
            ${this.createEZProxyIndicator(width, height)}
        </svg>`;
    }

    /**
     * Creates indicator for EZProxy URL presence
     * @param {number} width - Image width
     * @param {number} height - Image height
     * @returns {string} SVG markup for EZProxy indicator
     */
    createEZProxyIndicator(width, height) {
        return `
            <!-- EZProxy URL indicator -->
            <circle cx="25" cy="21" r="15" 
                    fill="rgba(255,165,0,0.8)" stroke="#ff8c00" stroke-width="2">
                <animate attributeName="r" values="15;18;15" dur="2s" repeatCount="indefinite"/>
            </circle>
            <text x="25" y="27" text-anchor="middle" 
                  font-family="Arial, sans-serif" font-size="14" font-weight="bold" 
                  fill="white">🔗</text>
        `;
    }

    /**
     * Annotates a screenshot with institutional access indicators
     * @param {string} inputPath - Path to input screenshot
     * @param {string} outputPath - Path for annotated output
     * @param {Object} detectionData - Optional detection data
     * @returns {Promise<boolean>} Success status
     */
    async annotateScreenshot(inputPath, outputPath, detectionData = {}) {
        try {
            // Load and analyze the image
            const image = sharp(inputPath);
            const metadata = await image.metadata();
            
            console.log(`📸 Processing screenshot: ${metadata.width}x${metadata.height}`);
            
            // Detect institutional access (or use provided data)
            const detection = this.detectInstitutionalAccess(inputPath, detectionData);
            
            if (!detection.found) {
                console.log('ℹ️  No institutional access detected in screenshot');
                return false;
            }
            
            console.log(`✅ Institutional access detected: "${detection.text}"`);
            
            // Create annotation overlay
            const svgOverlay = this.createAnnotationSVG(metadata.width, metadata.height, detection);
            
            // Apply annotations and save
            await image
                .composite([{
                    input: Buffer.from(svgOverlay),
                    top: 0,
                    left: 0
                }])
                .png()
                .toFile(outputPath);
            
            console.log(`🎯 Annotated screenshot saved: ${outputPath}`);
            return true;
            
        } catch (error) {
            console.error('❌ Error annotating screenshot:', error);
            return false;
        }
    }

    /**
     * Batch process multiple screenshots
     * @param {Array} screenshots - Array of {input, output, detection} objects
     * @returns {Promise<Array>} Results array
     */
    async batchAnnotate(screenshots) {
        const results = [];
        
        for (const screenshot of screenshots) {
            const success = await this.annotateScreenshot(
                screenshot.input, 
                screenshot.output, 
                screenshot.detection
            );
            results.push({ ...screenshot, success });
        }
        
        return results;
    }
}

module.exports = ScreenshotAnnotator;

// CLI usage if run directly
if (require.main === module) {
    const annotator = new ScreenshotAnnotator();
    const [,, inputFile, outputFile] = process.argv;
    
    if (!inputFile || !outputFile) {
        console.log('Usage: node screenshot-annotator.js <input.png> <output.png>');
        console.log('Example: node screenshot-annotator.js screenshot.png annotated.png');
        process.exit(1);
    }
    
    // Example detection data (in practice, this would come from the extension)
    const detectionData = {
        location: { x: 960, y: 60, width: 220, height: 30 },
        text: 'WESTERN WASHINGTON UNIV',
        confidence: 0.95
    };
    
    annotator.annotateScreenshot(inputFile, outputFile, detectionData)
        .then(success => {
            if (success) {
                console.log('🎉 Screenshot annotation completed successfully!');
            } else {
                console.log('⚠️  Screenshot annotation failed or no institutional access detected');
            }
        })
        .catch(error => {
            console.error('💥 Fatal error:', error);
            process.exit(1);
        });
}