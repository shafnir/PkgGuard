/**
 * Tests for the PackageExtractor utility.
 */

import { PackageExtractor } from '../utils/PackageExtractor.js';

describe('PackageExtractor', () => {
  describe('extractPackages', () => {
    describe('Python package extraction', () => {
      it('should extract packages from pip install commands', () => {
        const result = PackageExtractor.extractPackages('pip install numpy pandas');
        
        expect(result.isInstallCommand).toBe(true);
        expect(result.ecosystem).toBe('python');
        expect(result.packageManager).toBe('pip');
        expect(result.packages).toHaveLength(2);
        expect(result.packages[0].name).toBe('numpy');
        expect(result.packages[1].name).toBe('pandas');
      });

      it('should extract packages from pip3 install commands', () => {
        const result = PackageExtractor.extractPackages('pip3 install requests');
        
        expect(result.isInstallCommand).toBe(true);
        expect(result.ecosystem).toBe('python');
        expect(result.packageManager).toBe('pip3');
        expect(result.packages).toHaveLength(1);
        expect(result.packages[0].name).toBe('requests');
      });

      it('should extract packages from python -m pip install commands', () => {
        const result = PackageExtractor.extractPackages('python -m pip install django flask');
        
        expect(result.isInstallCommand).toBe(true);
        expect(result.ecosystem).toBe('python');
        expect(result.packageManager).toBe('pip');
        expect(result.packages).toHaveLength(2);
        expect(result.packages[0].name).toBe('django');
        expect(result.packages[1].name).toBe('flask');
      });

      it('should extract packages from poetry add commands', () => {
        const result = PackageExtractor.extractPackages('poetry add fastapi uvicorn');
        
        expect(result.isInstallCommand).toBe(true);
        expect(result.ecosystem).toBe('python');
        expect(result.packageManager).toBe('poetry');
        expect(result.packages).toHaveLength(2);
        expect(result.packages[0].name).toBe('fastapi');
        expect(result.packages[1].name).toBe('uvicorn');
      });

      it('should extract packages from pipenv install commands', () => {
        const result = PackageExtractor.extractPackages('pipenv install selenium');
        
        expect(result.isInstallCommand).toBe(true);
        expect(result.ecosystem).toBe('python');
        expect(result.packageManager).toBe('pipenv');
        expect(result.packages).toHaveLength(1);
        expect(result.packages[0].name).toBe('selenium');
      });

      it('should handle version specifiers', () => {
        const result = PackageExtractor.extractPackages('pip install numpy==1.21.0 pandas>=1.3.0');
        
        expect(result.packages).toHaveLength(2);
        expect(result.packages[0].name).toBe('numpy');
        expect(result.packages[0].version).toBe('1.21.0');
        expect(result.packages[1].name).toBe('pandas');
        expect(result.packages[1].version).toBe('1.3.0');
      });

      it('should handle extras', () => {
        const result = PackageExtractor.extractPackages('pip install requests[socks] pytest[testing]');
        
        expect(result.packages).toHaveLength(2);
        expect(result.packages[0].name).toBe('requests');
        expect(result.packages[0].flags).toContain('extra:socks');
        expect(result.packages[1].name).toBe('pytest');
        expect(result.packages[1].flags).toContain('extra:testing');
      });

      it('should handle git URLs', () => {
        const result = PackageExtractor.extractPackages('pip install git+https://github.com/user/repo.git');
        
        expect(result.packages).toHaveLength(1);
        expect(result.packages[0].name).toBe('repo');
        expect(result.packages[0].flags).toContain('vcs');
      });

      it('should handle editable installs', () => {
        const result = PackageExtractor.extractPackages('pip install -e /path/to/package');
        
        expect(result.packages).toHaveLength(1);
        expect(result.packages[0].name).toBe('package');
        expect(result.packages[0].flags).toContain('editable');
      });

      it('should ignore flags and options', () => {
        const result = PackageExtractor.extractPackages('pip install --upgrade --user numpy');
        
        expect(result.packages).toHaveLength(1);
        expect(result.packages[0].name).toBe('numpy');
      });
    });

    describe('JavaScript package extraction', () => {
      it('should extract packages from npm install commands', () => {
        const result = PackageExtractor.extractPackages('npm install react lodash');
        
        expect(result.isInstallCommand).toBe(true);
        expect(result.ecosystem).toBe('javascript');
        expect(result.packageManager).toBe('npm');
        expect(result.packages).toHaveLength(2);
        expect(result.packages[0].name).toBe('react');
        expect(result.packages[1].name).toBe('lodash');
      });

      it('should extract packages from yarn add commands', () => {
        const result = PackageExtractor.extractPackages('yarn add express axios');
        
        expect(result.isInstallCommand).toBe(true);
        expect(result.ecosystem).toBe('javascript');
        expect(result.packageManager).toBe('yarn');
        expect(result.packages).toHaveLength(2);
        expect(result.packages[0].name).toBe('express');
        expect(result.packages[1].name).toBe('axios');
      });

      it('should extract packages from pnpm add commands', () => {
        const result = PackageExtractor.extractPackages('pnpm add vue typescript');
        
        expect(result.isInstallCommand).toBe(true);
        expect(result.ecosystem).toBe('javascript');
        expect(result.packageManager).toBe('pnpm');
        expect(result.packages).toHaveLength(2);
        expect(result.packages[0].name).toBe('vue');
        expect(result.packages[1].name).toBe('typescript');
      });

      it('should extract packages from bun add commands', () => {
        const result = PackageExtractor.extractPackages('bun add next.js tailwindcss');
        
        expect(result.isInstallCommand).toBe(true);
        expect(result.ecosystem).toBe('javascript');
        expect(result.packageManager).toBe('bun');
        expect(result.packages).toHaveLength(2);
        expect(result.packages[0].name).toBe('next.js');
        expect(result.packages[1].name).toBe('tailwindcss');
      });

      it('should handle scoped packages', () => {
        const result = PackageExtractor.extractPackages('npm install @angular/core @types/node');
        
        expect(result.packages).toHaveLength(2);
        expect(result.packages[0].name).toBe('@angular/core');
        expect(result.packages[1].name).toBe('@types/node');
      });

      it('should handle version specifiers', () => {
        const result = PackageExtractor.extractPackages('npm install react@18.2.0 lodash@^4.17.21');
        
        expect(result.packages).toHaveLength(2);
        expect(result.packages[0].name).toBe('react');
        expect(result.packages[0].version).toBe('18.2.0');
        expect(result.packages[1].name).toBe('lodash');
        expect(result.packages[1].version).toBe('^4.17.21');
      });

      it('should handle git URLs', () => {
        const result = PackageExtractor.extractPackages('npm install git+https://github.com/user/repo.git');
        
        expect(result.packages).toHaveLength(1);
        expect(result.packages[0].name).toBe('repo');
        expect(result.packages[0].flags).toContain('vcs');
      });

      it('should handle relative paths', () => {
        const result = PackageExtractor.extractPackages('npm install ./local-package ../other-package');
        
        expect(result.packages).toHaveLength(2);
        expect(result.packages[0].name).toBe('local-package');
        expect(result.packages[0].flags).toContain('local');
        expect(result.packages[1].name).toBe('other-package');
        expect(result.packages[1].flags).toContain('local');
      });

      it('should ignore flags and options', () => {
        const result = PackageExtractor.extractPackages('npm install --save-dev --exact jest');
        
        expect(result.packages).toHaveLength(1);
        expect(result.packages[0].name).toBe('jest');
      });
    });

    describe('Non-install commands', () => {
      it('should return empty results for non-install commands', () => {
        const commands = [
          'pip list',
          'npm run build',
          'poetry show',
          'yarn start',
          'ls -la',
          'echo "hello"'
        ];

        commands.forEach(command => {
          const result = PackageExtractor.extractPackages(command);
          expect(result.isInstallCommand).toBe(false);
          expect(result.packages).toHaveLength(0);
        });
      });

      it('should handle unrecognized commands', () => {
        const result = PackageExtractor.extractPackages('unknown-command some-package');
        
        expect(result.isInstallCommand).toBe(false);
        expect(result.ecosystem).toBe('mixed');
        expect(result.packageManager).toBe('unknown');
        expect(result.packages).toHaveLength(0);
      });
    });
  });

  describe('isInstallCommand', () => {
    it('should correctly identify install commands', () => {
      const installCommands = [
        'pip install numpy',
        'pip3 install requests',
        'python -m pip install django',
        'poetry add fastapi',
        'pipenv install flask',
        'npm install react',
        'npm i lodash',
        'yarn add express',
        'pnpm add vue',
        'bun add next.js'
      ];

      installCommands.forEach(command => {
        expect(PackageExtractor.isInstallCommand(command)).toBe(true);
      });
    });

    it('should correctly identify non-install commands', () => {
      const nonInstallCommands = [
        'pip list',
        'npm run build',
        'poetry show',
        'yarn start',
        'ls -la',
        'echo "hello"',
        'git clone repo'
      ];

      nonInstallCommands.forEach(command => {
        expect(PackageExtractor.isInstallCommand(command)).toBe(false);
      });
    });
  });

  describe('getEcosystem', () => {
    it('should correctly identify Python ecosystem', () => {
      const pythonCommands = [
        'pip install numpy',
        'pip3 install requests',
        'python -m pip install django',
        'poetry add fastapi',
        'pipenv install flask',
        'conda install pandas',
        'mamba install scikit-learn'
      ];

      pythonCommands.forEach(command => {
        expect(PackageExtractor.getEcosystem(command)).toBe('python');
      });
    });

    it('should correctly identify JavaScript ecosystem', () => {
      const jsCommands = [
        'npm install react',
        'npm i lodash',
        'yarn add express',
        'pnpm add vue',
        'bun add next.js'
      ];

      jsCommands.forEach(command => {
        expect(PackageExtractor.getEcosystem(command)).toBe('javascript');
      });
    });

    it('should return mixed for unrecognized commands', () => {
      const mixedCommands = [
        'unknown-command package',
        'ls -la',
        'echo "hello"'
      ];

      mixedCommands.forEach(command => {
        expect(PackageExtractor.getEcosystem(command)).toBe('mixed');
      });
    });
  });

  describe('validatePackageName', () => {
    describe('Python package names', () => {
      it('should validate correct Python package names', () => {
        const validNames = [
          'numpy',
          'pandas',
          'requests',
          'django-rest-framework',
          'python_dotenv',
          'Pillow',
          'package123',
          'my_package',
          'my-package',
          'package.name'
        ];

        validNames.forEach(name => {
          expect(PackageExtractor.validatePackageName(name, 'python')).toBe(true);
        });
      });

      it('should reject invalid Python package names', () => {
        const invalidNames = [
          '',
          '123package',
          '-package',
          'package-',
          'package@version',
          'package/name',
          'package\\name',
          'package space'
        ];

        invalidNames.forEach(name => {
          expect(PackageExtractor.validatePackageName(name, 'python')).toBe(false);
        });
      });
    });

    describe('JavaScript package names', () => {
      it('should validate correct JavaScript package names', () => {
        const validNames = [
          'react',
          'lodash',
          'express',
          '@angular/core',
          '@types/node',
          'package-name',
          'package_name',
          'package123',
          'my.package'
        ];

        validNames.forEach(name => {
          expect(PackageExtractor.validatePackageName(name, 'javascript')).toBe(true);
        });
      });

      it('should reject invalid JavaScript package names', () => {
        const invalidNames = [
          '',
          '@invalid',
          '@',
          'package@version',
          'package/name',
          'package\\name',
          'package space',
          '@scope/',
          '@/package'
        ];

        invalidNames.forEach(name => {
          expect(PackageExtractor.validatePackageName(name, 'javascript')).toBe(false);
        });
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty commands', () => {
      const result = PackageExtractor.extractPackages('');
      
      expect(result.isInstallCommand).toBe(false);
      expect(result.packages).toHaveLength(0);
    });

    it('should handle commands with only whitespace', () => {
      const result = PackageExtractor.extractPackages('   \t\n  ');
      
      expect(result.isInstallCommand).toBe(false);
      expect(result.packages).toHaveLength(0);
    });

    it('should handle commands with only package manager', () => {
      const result = PackageExtractor.extractPackages('pip install');
      
      expect(result.isInstallCommand).toBe(false);
      expect(result.packages).toHaveLength(0);
    });

    it('should handle complex version specifiers', () => {
      const result = PackageExtractor.extractPackages('pip install "package>=1.0.0,<2.0.0"');
      
      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].name).toBe('package');
    });

    it('should handle mixed quotes', () => {
      const result = PackageExtractor.extractPackages('pip install "package1" \'package2\'');
      
      expect(result.packages).toHaveLength(2);
      expect(result.packages[0].name).toBe('package1');
      expect(result.packages[1].name).toBe('package2');
    });

    it('should handle case variations', () => {
      const commands = [
        'PIP INSTALL numpy',
        'Pip Install pandas',
        'NPM INSTALL react',
        'Npm Install lodash'
      ];

      commands.forEach(command => {
        const result = PackageExtractor.extractPackages(command);
        expect(result.isInstallCommand).toBe(true);
        expect(result.packages).toHaveLength(1);
      });
    });
  });

  describe('performance', () => {
    it('should handle large package lists efficiently', () => {
      const packages = Array(100).fill(null).map((_, i) => `package${i}`).join(' ');
      const command = `pip install ${packages}`;
      
      const startTime = Date.now();
      const result = PackageExtractor.extractPackages(command);
      const endTime = Date.now();
      
      expect(result.packages).toHaveLength(100);
      expect(endTime - startTime).toBeLessThan(100); // Should complete in under 100ms
    });

    it('should handle complex package specifications efficiently', () => {
      const complexCommand = 'pip install "package1>=1.0.0,<2.0.0" package2[extra1,extra2] git+https://github.com/user/repo.git@branch#egg=package3 ./local-package';
      
      const startTime = Date.now();
      const result = PackageExtractor.extractPackages(complexCommand);
      const endTime = Date.now();
      
      expect(result.packages).toHaveLength(4);
      expect(endTime - startTime).toBeLessThan(50); // Should complete in under 50ms
    });
  });
});