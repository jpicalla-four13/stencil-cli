require('colors');
const fsModule = require('fs');
const osModule = require('os');
const path = require('path');

const fsUtilsModule = require('./utils/fsUtils');
const { THEME_PATH, API_HOST } = require('../constants');

class StencilConfigManager {
    constructor({
        themePath = THEME_PATH,
        fs = fsModule,
        os = osModule,
        fsUtils = fsUtilsModule,
        logger = console,
    } = {}) {
        this.oldConfigFileName = '.stencil';
        this.configFileName = 'config.stencil.json';
        this.secretsFileName = 'secrets.stencil.json';

        this.themePath = themePath;
        this.oldConfigPath = path.join(themePath, this.oldConfigFileName);
        this.configPath = path.join(themePath, this.configFileName);
        this.secretsPath = path.join(themePath, this.secretsFileName);
        this.secretFieldsSet = new Set(['accessToken', 'githubToken']);

        this._fs = fs;
        this._os = os;
        this._fsUtils = fsUtils;
        this._logger = logger;
    }

    /**
     * @param {boolean} ignoreFileNotExists
     * @param {boolean} ignoreMissingFields
     * @returns {object|null}
     */
    async read(ignoreFileNotExists = false, ignoreMissingFields = false) {
        if (this._fs.existsSync(this.oldConfigPath)) {
            let parsedConfig;
            try {
                parsedConfig = await this._fsUtils.parseJsonFile(this.oldConfigPath);
                // Tolerate broken files. We should migrate the old config first
                //  and then validation will throw an error about missing fields
                // eslint-disable-next-line no-empty
            } catch {
                parsedConfig = {};
            }
            await this._migrateOldConfig(parsedConfig);
            return this._validateStencilConfig(parsedConfig, ignoreMissingFields);
        }

        const generalConfig = this._fs.existsSync(this.configPath)
            ? await this._fsUtils.parseJsonFile(this.configPath)
            : null;
        // const secretsConfig = await this._getSecretsConfig(generalConfig);
        const secretsConfig = this._getSecretsConfigFromEnvVars();

        if (generalConfig || secretsConfig) {
            const parsedConfig = { ...generalConfig, ...secretsConfig };
            return this._validateStencilConfig(parsedConfig, ignoreMissingFields);
        }

        if (ignoreFileNotExists) {
            return null;
        }

        throw new Error('Please run'.red + ' $ stencil init'.cyan + ' first.'.red);
    }

    /**
     * @param {object} config
     */
    async save(config, envFile) {
        const { generalConfig, secretsConfig } = this._splitStencilConfig(config);

        await this._fs.promises.writeFile(this.configPath, JSON.stringify(generalConfig, null, 2));
        // await this._fs.promises.writeFile(this.secretsPath, JSON.stringify(secretsConfig, null, 2));

        this._setEnvValueToFile('STENCIL_ACCESS_TOKEN', secretsConfig.accessToken, envFile);
        this._setEnvValueToFile('STENCIL_GITHUB_TOKEN', secretsConfig.githubToken, envFile);
    }

    /**
     * @param {string} key
     * @param {string} value
     * @param {string} envFile
     */
    _setEnvValueToFile(key, value, envFile) {
        if (!this._fs.existsSync(envFile)) {
            this._fs.openSync(envFile, 'a');
        }

        const vars = this._fs
            .readFileSync(envFile, 'utf8')
            .split(this._os.EOL)
            .filter((v) => !v);

        const target = vars.find((line) => line.match(new RegExp(`(?<!#\\s*)${key}(?==)`)));
        const targetIndex = vars.indexOf(target);

        if (targetIndex !== -1) {
            vars.splice(targetIndex, 1, `${key}=${value || ''}`);
        } else {
            vars.push(`${key}=${value || ''}`);
        }

        this._fs.writeFileSync(envFile, vars.join(this._os.EOL));
    }

    /**
     * @private
     * @param {object} config
     */
    _splitStencilConfig(config) {
        return Object.entries(config).reduce(
            (res, [key, value]) => {
                if (this.secretFieldsSet.has(key)) {
                    res.secretsConfig[key] = value;
                } else {
                    res.generalConfig[key] = value;
                }
                return res;
            },
            { secretsConfig: {}, generalConfig: {} },
        );
    }

    /**
     * @private
     * @param {object | null} config
     * @returns {Promise<object | null>}
     */
    async _getSecretsConfig(generalConfig) {
        if (generalConfig && generalConfig.secretsFileName) {
            const secretsPath = path.join(this.themePath, generalConfig.secretsFileName);

            if (this._fs.existsSync(secretsPath)) {
                return this._fsUtils.parseJsonFile(secretsPath);
            }
        }

        return this._fs.existsSync(this.secretsPath)
            ? this._fsUtils.parseJsonFile(this.secretsPath)
            : null;
    }

    _getSecretsConfigFromEnvVars() {
        return {
            accessToken: process.env.STENCIL_ACCESS_TOKEN || null,
            githubToken: process.env.STENCIL_GITHUB_TOKEN || null,
        };
    }

    /**
     * @private
     * @param {object} config
     * @param {boolean} ignoreMissingFields
     * @returns {object}
     */
    _validateStencilConfig(configFile, ignoreMissingFields) {
        const config = configFile;

        if (!ignoreMissingFields && (!config.normalStoreUrl || !config.customLayouts)) {
            throw new Error(
                'Error: Your stencil config is outdated. Please run'.red +
                    ' $ stencil init'.cyan +
                    ' again.'.red,
            );
        }

        if (!config.apiHost) {
            this._logger.log(
                `No api host found in config file, falling back to ${API_HOST}. You may need to run 'stencil init' again.`,
            );
            config.apiHost = API_HOST;
        }

        return config;
    }

    /**
     * @private
     * @param {object} config
     */
    async _migrateOldConfig(config) {
        this._logger.log(
            `Detected a deprecated ${this.oldConfigFileName.cyan} file.\n` +
                `It will be replaced with ${this.configFileName.cyan} and ${this.secretsFileName.cyan}\n`,
        );

        await this.save(config);
        await this._fs.promises.unlink(this.oldConfigPath);

        this._logger.log(
            `The deprecated ${this.oldConfigFileName.cyan} file was successfully replaced.\n` +
                `Make sure to add ${this.secretsFileName.cyan} to .gitignore.\n` +
                `${this.configFileName.cyan} can be tracked by git if you wish.\n`,
        );
    }
}

module.exports = StencilConfigManager;
