/**
 * UI decorators for package trust badges.
 * Handles the visual representation of trust scores.
 * 
 * @copilot.generateExample usage=true
 * @copilot.avoid any=true
 */

import * as vscode from 'vscode';
import { TrustScore } from '../types';

/**
 * Trust badge decorator types.
 */
export class TrustDecorators {
    private readonly highTrustDecoration: vscode.TextEditorDecorationType;
    private readonly mediumTrustDecoration: vscode.TextEditorDecorationType;
    private readonly lowTrustDecoration: vscode.TextEditorDecorationType;

    constructor() {
        // Create decoration types with different colors
        this.highTrustDecoration = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: '•',
                color: '#2ecc40', // green
                margin: '0 0 0 1em',
                fontWeight: 'bold'
            }
        });

        this.mediumTrustDecoration = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: '•',
                color: '#ffb400', // yellow/orange
                margin: '0 0 0 1em',
                fontWeight: 'bold'
            }
        });

        this.lowTrustDecoration = vscode.window.createTextEditorDecorationType({
            after: {
                contentText: '•',
                color: '#ff4136', // red
                margin: '0 0 0 1em',
                fontWeight: 'bold'
            }
        });
    }

    /**
     * Apply trust badges to the editor.
     * 
     * @param editor - The text editor to decorate
     * @param scores - Array of trust scores with positions
     */
    public applyDecorations(
        editor: vscode.TextEditor,
        scores: Array<{ score: TrustScore; range: vscode.Range }>
    ): void {
        const highTrustRanges: vscode.Range[] = [];
        const mediumTrustRanges: vscode.Range[] = [];
        const lowTrustRanges: vscode.Range[] = [];

        // Group ranges by trust level
        for (const { score, range } of scores) {
            switch (score.level) {
                case 'high':
                    highTrustRanges.push(range);
                    break;
                case 'medium':
                    mediumTrustRanges.push(range);
                    break;
                case 'low':
                    lowTrustRanges.push(range);
                    break;
            }
        }

        // Apply decorations
        editor.setDecorations(this.highTrustDecoration, highTrustRanges);
        editor.setDecorations(this.mediumTrustDecoration, mediumTrustRanges);
        editor.setDecorations(this.lowTrustDecoration, lowTrustRanges);
    }

    /**
     * Clear all trust badges from the editor.
     * 
     * @param editor - The text editor to clear decorations from
     */
    public clearDecorations(editor: vscode.TextEditor): void {
        editor.setDecorations(this.highTrustDecoration, []);
        editor.setDecorations(this.mediumTrustDecoration, []);
        editor.setDecorations(this.lowTrustDecoration, []);
    }

    /**
     * Dispose of all decoration types.
     */
    public dispose(): void {
        this.highTrustDecoration.dispose();
        this.mediumTrustDecoration.dispose();
        this.lowTrustDecoration.dispose();
    }
} 