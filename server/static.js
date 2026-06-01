const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const express = require('express');
const utils = require('./core/utils');
const webAppDir = require('../build/appdir');

const log = new (require('./core/AppLogger'))().log;//singleton

// Функция создания zip архива с помощью 7zip
async function generateZip(zipFile, dataFile, dataFileInZip) {
    const tempDir = path.dirname(zipFile);
    const tempExtractDir = path.join(tempDir, '_temp_extract_' + Date.now());
    
    try {
        await fs.ensureDir(tempExtractDir);
        
        // Копируем файл во временную директорию с нужным именем
        const tempDataFile = path.join(tempExtractDir, dataFileInZip);
        await fs.copy(dataFile, tempDataFile);
        
        // Путь к 7zip (можно вынести в config)
        const sevenZipPath = config.sevenZipPath || '7z';
        
        // Создаем архив: 7z a -tzip archive.zip файл
        const command = `"${sevenZipPath}" a -tzip "${zipFile}" "${tempDataFile}"`;
        
        const { stdout, stderr } = await execPromise(command);
        
        if (stderr && !stderr.toLowerCase().includes('everything is ok')) {
            console.warn('7zip warnings:', stderr);
        }
        
    } catch (error) {
        throw new Error(`Failed to create zip with 7zip: ${error.message}`);
    } finally {
        // Очищаем временную директорию
        await fs.remove(tempExtractDir);
    }
}

module.exports = (app, config) => {
    /*
    config.bookPathStatic = `${config.rootPathStatic}/book`;
    config.bookDir = `${config.publicFilesDir}/book`;
    */
    //загрузка или восстановление файлов в /public-files, при необходимости
    app.use([`${config.bookPathStatic}/:fileName/:fileType`, `${config.bookPathStatic}/:fileName`], async(req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            return next();
        }

        try {
            const fileName = req.params.fileName;
            const fileType = req.params.fileType;

            if (path.extname(fileName) === '') {//восстановление файлов {hash}.raw, {hash}.zip
                let bookFile = `${config.bookDir}/${fileName}`;
                const bookFileDesc = `${bookFile}.d.json`;

                //восстановим из json-файла описания
                if (await fs.pathExists(bookFile) && await fs.pathExists(bookFileDesc)) {
                    await utils.touchFile(bookFile);
                    await utils.touchFile(bookFileDesc);

                    let desc = await fs.readFile(bookFileDesc, 'utf8');
                    let downFileName = (JSON.parse(desc)).downFileName;
                    let gzipped = true;

                    if (!req.acceptsEncodings('gzip') || fileType) {
                        const rawFile = `${bookFile}.raw`;
                        //не принимает gzip, тогда распакуем
                        if (!await fs.pathExists(rawFile))
                            await utils.gunzipFile(bookFile, rawFile);

                        gzipped = false;

                        if (fileType === undefined || fileType === 'raw') {
                            bookFile = rawFile;
                        } else if (fileType === 'zip') {
                            //создаем zip-файл с помощью 7zip
                            bookFile += '.zip';
                            if (!await fs.pathExists(bookFile))
                                await generateZip(bookFile, rawFile, downFileName);
                            downFileName += '.zip';
                        } else {
                            throw new Error(`Unsupported file type: ${fileType}`);
                        }
                    }

                    //отдача файла
                    if (gzipped)
                        res.set('Content-Encoding', 'gzip');
                    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(downFileName)}`);
                    res.sendFile(bookFile);
                    return;
                } else {
                    await fs.remove(bookFile);
                    await fs.remove(bookFileDesc);
                }
            }
        } catch(e) {
            log(LM_ERR, e.message);
        }

        return next();
    });

    //иначе просто отдаем запрошенный файл из /public-files
    app.use(config.bookPathStatic, express.static(config.bookDir));

    if (config.rootPathStatic) {
        //подмена rootPath в файлах статики WebApp при необходимости
        app.use(config.rootPathStatic, async(req, res, next) => {
            if (req.method !== 'GET' && req.method !== 'HEAD') {
                return next();
            }

            try {
                const reqPath = (req.path == '/' ? '/index.html' : req.path);
                const ext = path.extname(reqPath);
                if (ext == '.html' || ext == '.js' || ext == '.css') {
                    const reqFile = `${config.publicDir}${reqPath}`;
                    const flagFile = `${reqFile}.replaced`;

                    if (!await fs.pathExists(flagFile) && await fs.pathExists(reqFile)) {
                        const content = await fs.readFile(reqFile, 'utf8');
                        const re = new RegExp(`/${webAppDir}`, 'g');
                        await fs.writeFile(reqFile, content.replace(re, `${config.rootPathStatic}/${webAppDir}`));
                        await fs.writeFile(flagFile, '');
                    }
                }
            } catch(e) {
                log(LM_ERR, e.message);
            }

            return next();
        });
    }

    //статика файлов WebApp
    app.use(config.rootPathStatic, express.static(config.publicDir));
};
