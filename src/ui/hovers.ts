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
    private verboseState: Map<string, boolean> = new Map();

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

        // Trust level indicator (original color circles)
        let levelEmoji = score.level === 'high' ? '🟢' : score.level === 'medium' ? '🟡' : score.level === 'low' ? '🔴' : '⚪';
        let scoreDisplay = score.score === null ? 'Ignored' : Number.isInteger(score.score) ? score.score : Math.round(score.score);
        markdown.appendMarkdown(`### ${levelEmoji} Trust Score: ${scoreDisplay}\n\n`);

        // If ignored, show ignore message and note, no risk factors or evidence
        if (score.level === 'ignored') {
            if (score.scoreReasons && score.scoreReasons.length > 0) {
                for (const reason of score.scoreReasons) {
                    markdown.appendMarkdown(`- ${reason}\n`);
                }
            }
            // Add Unignore action (UI only, logic next)
            markdown.appendMarkdown(`\n[Unignore package](command:pkgguard.unignorePackage?%5B%22${encodeURIComponent(score.packageName)}%22%5D)\n`);
            markdown.isTrusted = true;
            return markdown;
        }

        // Key Factors (always show for JS and Python)
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
                const emoji = risk.color === 'red' ? '🔴' : '🟠';
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
        // Maintainers: show actual count if available
        const maintCount = (score as any).evidence.maintainerCount ?? (score as any).maintainerCount;
        if (typeof maintCount === 'number' && maintCount > 1) {
            markdown.appendMarkdown(`- 👥 Maintainers: ${maintCount}\n`);
        } else if (typeof maintCount === 'number' && maintCount === 1) {
            markdown.appendMarkdown(`- 👥 Maintainers: Single\n`);
        } else if (evidence.multipleMaintainers) {
            markdown.appendMarkdown(`- 👥 Maintainers: Multiple\n`);
        } else {
            markdown.appendMarkdown(`- 👥 Maintainers: Single\n`);
        }

        if (evidence.vulnerabilities > 0) {
            markdown.appendMarkdown(`- ⚠️ High severity vulnerabilities: ${evidence.vulnerabilities}\n`);
        }

        // Recommendations/Summary based on trust level
        if (score.level === 'high') {
            markdown.appendMarkdown('\n**This is a widely trusted and established package.**\n');
        } else if (score.level === 'medium') {
            if (score.riskFactors && score.riskFactors.length > 0) {
                markdown.appendMarkdown('\n**This package has some risk factors. Please review the details before using.**\n');
            } else {
                markdown.appendMarkdown('\n**This package is not extremely popular or well-established, but no specific risks were detected.**\n');
            }
        } else {
            if (score.riskFactors && score.riskFactors.length > 0) {
                markdown.appendMarkdown('\n**This package is considered risky. Manual review and caution are strongly advised.**\n');
            } else {
                markdown.appendMarkdown('\n**This package is not widely trusted or established, but no specific risks were detected.**\n');
            }
        }

        // Always add an extra newline before links
        markdown.appendMarkdown('\n');

        // Add registry link (only if present in evidence)
        if (score.evidence && (score.evidence as any).registryUrl) {
            const registryUrl = (score.evidence as any).registryUrl;
            const isPyPI = registryUrl.includes('pypi.org');
            markdown.appendMarkdown(`[🔗 View on ${isPyPI ? 'PyPI' : 'npm'}](${registryUrl})`);
        }
        // Add GitHub link (if present, on same line as registry link)
        if ((score as any).githubRepo) {
            markdown.appendMarkdown(` | [🐙 GitHub](${(score as any).githubRepo})\n`);
        }
        // Add Ignore/Unignore action (always on its own line, after links)
        if (score.level === 'low' || score.level === 'medium') {
            markdown.appendMarkdown(`\n[Ignore package](command:pkgguard.ignorePackage?%5B%22${encodeURIComponent(score.packageName)}%22%5D)\n`);
        }

        markdown.isTrusted = true;
        return markdown;
    }
} 