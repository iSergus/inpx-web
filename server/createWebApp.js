const fs = require('fs-extra');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const webApp = require('../dist/public.json');

module.exports = async(config) => {
    const verFile = `${config.publicDir}/version.txt`;
    const zipFile = `${config.tempDir}/public.zip`;

    if (await fs.pathExists(verFile)) {
        const curPublicVersion = await fs.readFile(verFile, 'utf8');
        if (curPublicVersion == config.version + config.rootPathStatic)
            return;
    }

    await fs.remove(config.publicDir);
    await fs.ensureDir(config.publicDir);

    // сохраняем webApp в zip файл
    await fs.writeFile(zipFile, webApp.data, {encoding: 'base64'});

    // извлекаем с помощью 7zip
    try {
        // Путь к 7zip (можно настроить через config)
        const sevenZipPath = config.sevenZipPath || '7z';
        
        // Команда для распаковки: 7z x archive.zip -ooutputDir -y
        const command = `"${sevenZipPath}" x "${zipFile}" -o"${config.publicDir}" -y`;
        
        const { stdout, stderr } = await execPromise(command);
        
        if (stderr && !stderr.toLowerCase().includes('everything is ok')) {
            console.warn('7zip warnings:', stderr);
        }
        
        console.log('7zip output:', stdout);
        
    } catch (error) {
        console.error('7zip extraction failed:', error);
        throw new Error(`Failed to extract archive with 7zip: ${error.message}`);
    }

    await fs.writeFile(verFile, config.version + config.rootPathStatic);
    await fs.remove(zipFile);
};
