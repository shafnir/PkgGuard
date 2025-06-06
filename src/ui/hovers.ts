/**
 * Hover provider for package trust information.
 * Shows detailed package information on hover.
 * 
 * @copilot.generateExample usage=true
 * @copilot.avoid any=true
 */

import * as vscode from 'vscode';
import { TrustScore } from '../types';

/**
 * Hover provider for package trust information.
 */
export class TrustHoverProvider implements vscode.HoverProvider {
    private readonly scores: Map<string, TrustScore>;

    constructor() {
        this.scores = new Map();
    }

    /**
     * Update the cached trust scores.
     * 
     * @param scores - New trust scores to cache
     */
    public updateScores(scores: TrustScore[]): void {
        this.scores.clear();
        for (const score of scores) {
            this.scores.set(score.packageName, score);
        }
    }

    /**
     * Provide hover information for a package.
     * 
     * @param document - The document containing the package
     * @param position - The position of the package name
     * @param token - Cancellation token
     */
    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        const packageName = document.getText(wordRange);
        const score = this.scores.get(packageName);
        if (!score) {
            return null;
        }

        const markdown = this.createMarkdown(score);
        return new vscode.Hover(markdown, wordRange);
    }

    /**
     * Create markdown content for the hover.
     */
    private createMarkdown(score: TrustScore): vscode.MarkdownString {
        const { evidence, scoreReasons } = score;
        const markdown = new vscode.MarkdownString();

        // Trust level indicator (smaller circle)
        let levelEmoji = score.level === 'high' ? '<span style="font-size:0.6em">🟢</span>' : score.level === 'medium' ? '<span style="font-size:0.6em">🟡</span>' : score.level === 'low' ? '<span style="font-size:0.6em">🔴</span>' : '<span style="font-size:0.6em">⚪</span>';
        markdown.appendMarkdown(`### ${levelEmoji} Trust Score: ${score.score === null ? 'Ignored' : score.score}\n\n`);

        // If ignored, show ignore message and note, no risk factors or evidence
        if (score.level === 'ignored') {
            if (score.scoreReasons && score.scoreReasons.length > 0) {
                for (const reason of score.scoreReasons) {
                    markdown.appendMarkdown(`- ${reason}\n`);
                }
            }
            // Add Unignore action (UI only, logic next)
            markdown.appendMarkdown('\n[Unignore package](command:pkgguard.unignorePackage)\n');
            markdown.isTrusted = true;
            return markdown;
        }

        // Dominant reasons (top package, typosquat, etc.)
        if (scoreReasons && scoreReasons.length > 0) {
            markdown.appendMarkdown('**Key Factors:**\n');
            for (const reason of scoreReasons) {
                markdown.appendMarkdown(`- ${reason}\n`);
            }
            markdown.appendMarkdown('\n');
        }
        // Risk Factors (merged, colored, smaller)
        if (score.riskFactors && score.riskFactors.length > 0) {
            markdown.appendMarkdown('**Risk Factors:**\n');
            for (const risk of score.riskFactors) {
                const emoji = risk.color === 'red' ? '<span style="font-size:0.6em">🔴</span>' : '<span style="font-size:0.6em">🟡</span>';
                markdown.appendMarkdown(`- ${emoji} ${risk.text}\n`);
            }
        }

        // Evidence list
        markdown.appendMarkdown('#### Evidence:\n');
        markdown.appendMarkdown(`- ${evidence.exists ? '✅' : '❌'} Package exists on registry\n`);
        // Download data: show from PePy, or for top packages, from top-pypi-packages JSON
        if (evidence.downloads > 0) {
            markdown.appendMarkdown(`- 📦 Downloads: ${evidence.downloads.toLocaleString()}/week\n`);
        } else if (score.topDownloads && score.topDownloads > 0) {
            markdown.appendMarkdown(`- 📦 Downloads (top PyPI): ${score.topDownloads.toLocaleString()} total\n`);
        } else {
            markdown.appendMarkdown(`- 📦 Download data not available\n`);
        }
        // Release date: show as dd-mm-yyyy if available
        if (score.releaseDate) {
            markdown.appendMarkdown(`- ⏰ Release date: ${score.releaseDate}\n`);
        } else {
            markdown.appendMarkdown(`- ⏰ Release date: N/A\n`);
        }
        markdown.appendMarkdown(`- 👥 Maintainers: ${evidence.multipleMaintainers ? 'Multiple' : 'Single'}\n`);

        if (evidence.vulnerabilities > 0) {
            markdown.appendMarkdown(`- ⚠️ High severity vulnerabilities: ${evidence.vulnerabilities}\n`);
        }

        // Recommendations/Summary based on trust level
        if (score.level === 'high') {
            markdown.appendMarkdown('\n**This is a widely trusted and established package.**\n');
        } else if (score.level === 'medium') {
            markdown.appendMarkdown('\n**This package has some risk factors. Please review the details before using.**\n');
        } else {
            markdown.appendMarkdown('\n**This package is considered risky. Manual review and caution are strongly advised.**\n');
        }

        // Add Ignore action for red/orange packages (UI only, logic next)
        if (score.level === 'low' || score.level === 'medium') {
            markdown.appendMarkdown('\n[Ignore package](command:pkgguard.ignorePackage)\n');
        }

        markdown.isTrusted = true;
        return markdown;
    }
} 