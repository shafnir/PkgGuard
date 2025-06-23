/**
 * Terminal Text Decorators for PkgGuard
 * Provides visual enhancement for package names in terminal output
 * Uses ANSI escape codes for cross-platform terminal styling
 */

import { TrustScore } from '../types';

export class TerminalDecorator {
    // ANSI Color codes
    private static readonly COLORS = {
        reset: '\x1b[0m',
        bright: '\x1b[1m',
        dim: '\x1b[2m',
        underscore: '\x1b[4m',
        blink: '\x1b[5m',
        reverse: '\x1b[7m',
        hidden: '\x1b[8m',
        
        // Foreground colors
        black: '\x1b[30m',
        red: '\x1b[31m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        blue: '\x1b[34m',
        magenta: '\x1b[35m',
        cyan: '\x1b[36m',
        white: '\x1b[37m',
        
        // Background colors
        bgBlack: '\x1b[40m',
        bgRed: '\x1b[41m',
        bgGreen: '\x1b[42m',
        bgYellow: '\x1b[43m',
        bgBlue: '\x1b[44m',
        bgMagenta: '\x1b[45m',
        bgCyan: '\x1b[46m',
        bgWhite: '\x1b[47m'
    };

    /**
     * Create colored trust badge for terminal display
     */
    public static createTrustBadge(score: TrustScore): string {
        const emoji = score.level === 'high' ? '🟢' : 
                     score.level === 'medium' ? '🟡' : 
                     score.level === 'ignored' ? '⚪' : '🔴';
        
        const color = score.level === 'high' ? this.COLORS.green : 
                     score.level === 'medium' ? this.COLORS.yellow : 
                     score.level === 'ignored' ? this.COLORS.dim : this.COLORS.red;
        
        const scoreText = score.score === null ? 'IGN' : score.score.toString();
        
        return `${emoji} ${color}${scoreText}${this.COLORS.reset}`;
    }

    /**
     * Decorate package name with trust indicator
     */
    public static decoratePackageName(packageName: string, score: TrustScore): string {
        const badge = this.createTrustBadge(score);
        const color = score.level === 'high' ? this.COLORS.green : 
                     score.level === 'medium' ? this.COLORS.yellow : 
                     score.level === 'ignored' ? this.COLORS.dim : this.COLORS.red;
        
        return `${color}${this.COLORS.underscore}${packageName}${this.COLORS.reset} ${badge}`;
    }

    /**
     * Create comprehensive security report for terminal
     */
    public static createSecurityReport(
        packages: Array<{name: string, score: TrustScore, ecosystem: string}>
    ): string {
        let report = '\n🛡️  ' + this.COLORS.bright + 'PkgGuard Security Report' + this.COLORS.reset + '\n';
        report += '─'.repeat(50) + '\n\n';

        // Summary section
        const totalPackages = packages.length;
        const highRisk = packages.filter(p => p.score.level === 'low').length;
        const mediumRisk = packages.filter(p => p.score.level === 'medium').length;
        const lowRisk = packages.filter(p => p.score.level === 'high').length;
        const ignored = packages.filter(p => p.score.level === 'ignored').length;

        report += `📊 ${this.COLORS.bright}Summary:${this.COLORS.reset}\n`;
        report += `   Total packages: ${totalPackages}\n`;
        if (highRisk > 0) {
            report += `   ${this.COLORS.red}🔴 High risk: ${highRisk}${this.COLORS.reset}\n`;
        }
        if (mediumRisk > 0) {
            report += `   ${this.COLORS.yellow}🟡 Medium risk: ${mediumRisk}${this.COLORS.reset}\n`;
        }
        if (lowRisk > 0) {
            report += `   ${this.COLORS.green}🟢 Low risk: ${lowRisk}${this.COLORS.reset}\n`;
        }
        if (ignored > 0) {
            report += `   ${this.COLORS.dim}⚪ Ignored: ${ignored}${this.COLORS.reset}\n`;
        }
        report += '\n';

        // Detailed package analysis
        report += `📦 ${this.COLORS.bright}Package Analysis:${this.COLORS.reset}\n`;
        
        for (const pkg of packages) {
            const badge = this.createTrustBadge(pkg.score);
            const ecosystemBadge = pkg.ecosystem === 'python' ? '🐍' : '📦';
            
            report += `   ${ecosystemBadge} ${this.decoratePackageName(pkg.name, pkg.score)}\n`;
            
            // Show top risk factors for medium/high risk packages
            if ((pkg.score.level === 'low' || pkg.score.level === 'medium') && pkg.score.riskFactors) {
                for (const risk of pkg.score.riskFactors.slice(0, 2)) {
                    const riskColor = risk.color === 'red' ? this.COLORS.red : this.COLORS.yellow;
                    const riskEmoji = risk.color === 'red' ? '🔴' : '🟠';
                    report += `     ${riskEmoji} ${riskColor}${risk.text}${this.COLORS.reset}\n`;
                }
            }
            
            // Show key positive factors for high trust packages
            if (pkg.score.level === 'high' && pkg.score.scoreReasons) {
                const positiveReasons = pkg.score.scoreReasons.filter(r => 
                    r.includes('🏆') || r.includes('⭐') || r.includes('📦')
                );
                for (const reason of positiveReasons.slice(0, 1)) {
                    report += `     ${this.COLORS.green}✓ ${reason}${this.COLORS.reset}\n`;
                }
            }
            
            report += '\n';
        }

        // Recommendations
        if (highRisk > 0) {
            report += `⚠️  ${this.COLORS.red}${this.COLORS.bright}SECURITY RECOMMENDATIONS:${this.COLORS.reset}\n`;
            report += `   • Review high-risk packages before installation\n`;
            report += `   • Consider alternative packages with better trust scores\n`;
            report += `   • Use PkgGuard ignore feature for trusted internal packages\n\n`;
        } else if (mediumRisk > 0) {
            report += `💡 ${this.COLORS.yellow}${this.COLORS.bright}RECOMMENDATIONS:${this.COLORS.reset}\n`;
            report += `   • Monitor medium-risk packages for updates\n`;
            report += `   • Check package documentation and community support\n\n`;
        } else {
            report += `✅ ${this.COLORS.green}${this.COLORS.bright}ALL CLEAR:${this.COLORS.reset}\n`;
            report += `   • All packages have passed security checks\n`;
            report += `   • Safe to proceed with installation\n\n`;
        }

        return report;
    }

    /**
     * Create inline package annotation for command output
     */
    public static annotateCommand(command: string, packageScores: Map<string, TrustScore>): string {
        let annotatedCommand = command;
        
        for (const [packageName, score] of packageScores) {
            const badge = this.createTrustBadge(score);
            const regex = new RegExp(`\\b${packageName}\\b`, 'g');
            annotatedCommand = annotatedCommand.replace(regex, `${packageName} ${badge}`);
        }
        
        return annotatedCommand;
    }

    /**
     * Create progress indicator for package analysis
     */
    public static createProgressIndicator(current: number, total: number, packageName: string): string {
        const percentage = Math.round((current / total) * 100);
        const progressBar = '█'.repeat(Math.round(percentage / 10)) + '░'.repeat(10 - Math.round(percentage / 10));
        
        return `${this.COLORS.cyan}[${progressBar}] ${percentage}%${this.COLORS.reset} Analyzing ${this.COLORS.bright}${packageName}${this.COLORS.reset}...`;
    }

    /**
     * Create warning box for high-risk packages
     */
    public static createWarningBox(packages: string[]): string {
        const maxWidth = Math.max(60, Math.max(...packages.map(p => p.length)) + 20);
        const border = '═'.repeat(maxWidth);
        
        let warning = `\n${this.COLORS.red}╔${border}╗${this.COLORS.reset}\n`;
        warning += `${this.COLORS.red}║${this.COLORS.reset}${this.COLORS.bright} ⚠️  SECURITY WARNING ⚠️ ${' '.repeat(maxWidth - 25)}${this.COLORS.reset}${this.COLORS.red}║${this.COLORS.reset}\n`;
        warning += `${this.COLORS.red}╠${border}╣${this.COLORS.reset}\n`;
        warning += `${this.COLORS.red}║${this.COLORS.reset} High-risk packages detected:${' '.repeat(maxWidth - 32)}${this.COLORS.red}║${this.COLORS.reset}\n`;
        
        for (const pkg of packages) {
            const padding = ' '.repeat(maxWidth - pkg.length - 5);
            warning += `${this.COLORS.red}║${this.COLORS.reset}   • ${this.COLORS.yellow}${pkg}${this.COLORS.reset}${padding}${this.COLORS.red}║${this.COLORS.reset}\n`;
        }
        
        warning += `${this.COLORS.red}║${this.COLORS.reset}${' '.repeat(maxWidth)}${this.COLORS.red}║${this.COLORS.reset}\n`;
        warning += `${this.COLORS.red}║${this.COLORS.reset} Recommendation: Review packages before proceeding${' '.repeat(maxWidth - 48)}${this.COLORS.red}║${this.COLORS.reset}\n`;
        warning += `${this.COLORS.red}╚${border}╝${this.COLORS.reset}\n\n`;
        
        return warning;
    }

    /**
     * Create success confirmation box
     */
    public static createSuccessBox(packages: string[]): string {
        const maxWidth = Math.max(50, Math.max(...packages.map(p => p.length)) + 15);
        const border = '═'.repeat(maxWidth);
        
        let success = `\n${this.COLORS.green}╔${border}╗${this.COLORS.reset}\n`;
        success += `${this.COLORS.green}║${this.COLORS.reset}${this.COLORS.bright} ✅ SECURITY CHECK PASSED ✅${' '.repeat(maxWidth - 29)}${this.COLORS.reset}${this.COLORS.green}║${this.COLORS.reset}\n`;
        success += `${this.COLORS.green}╠${border}╣${this.COLORS.reset}\n`;
        success += `${this.COLORS.green}║${this.COLORS.reset} All packages verified safe:${' '.repeat(maxWidth - 29)}${this.COLORS.green}║${this.COLORS.reset}\n`;
        
        for (const pkg of packages) {
            const padding = ' '.repeat(maxWidth - pkg.length - 5);
            success += `${this.COLORS.green}║${this.COLORS.reset}   • ${this.COLORS.cyan}${pkg}${this.COLORS.reset}${padding}${this.COLORS.green}║${this.COLORS.reset}\n`;
        }
        
        success += `${this.COLORS.green}╚${border}╝${this.COLORS.reset}\n\n`;
        
        return success;
    }
}