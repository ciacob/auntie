'use strict';
const Fs = require('fs');
const Path = require('path');
const LineByLine = require('n-readlines');
const {getFileName} = require('./path-utils')

// Import constants
const {
    DIR,
    ROOT
} = require('./constants');

/**
 * Synchronously and recursively creates any directories implied by the given `filePath`. If directories already
 * exist, no action is taken.
 *
 * @param   filePath
 *          A file path to ensure parent directories of.
 *
 * @return  {boolean}
 *          Returns `true` if all implied parent directories already existed when this function was called; returns
 *          `false` if at least one directory has to be created.
 */
const ensureParentDirs = function (filePath) {
    const dirname = Path.dirname(filePath);
    if (Fs.existsSync(dirname)) {
        return true;
    }
    ensureParentDirs(dirname);
    Fs.mkdirSync(dirname);
    return false;
}
exports.ensureParentDirs = ensureParentDirs;

/**
 * Synchronously iterates through all the files in given `folderPath`, including
 * subdirectories, while filtering them by given `fileTypes`. The given `callback`
 * is called with each file's path, name, extension (type) and creation and modification
 * timestamps (in milliseconds).
 * @param   folderPath {string}
 *          Absolute, local path of a folder to synchronously open and visit.
 *
 * @param   fileTypes {string[]}
 *          Array of file extensions, such as: ["txt", "md"]. A leading dot is not expected.
 *          Two special constant values are permitted:
 *          - DIR will cause the method to also send directories information to `callback`.
 *            the `extension` callback parameter will receive the DIR constant value;
 *          - ROOT will cause the method to also send root folder information to `callback`.
 *            the `extension` callback parameter will receive the DIR constant value;
 *
 * @param   callback {function}
 *          Function having the signature:
 *
 *          onFileListed (path, name, extension, createdOn, modifiedOn);
 *
 *          If this function returns `false`, then the folder will be immediately closed,
 *          and iterating through his files will stop.
 *
 * @return  An Array with Strings containing the paths of the files that were skipped because
 *          they did not match any of the file types in the `fileTypes` argument.
 */
const visitFilesInFolder = function (folderPath, fileTypes, callback) {
    let currDirEntity;
    let currName;
    let currExtension;
    let currSrcPath;
    let currStats;
    let currCreationTime;
    let currModificationTime;
    visitFilesInFolder.mustExitNow = false;
    if (fileTypes.includes(ROOT)) {
        currName = getFileName(folderPath);
        currStats = Fs.lstatSync(folderPath);
        currCreationTime = currStats.ctimeMs;
        currModificationTime = currStats.mtimeMs;
        visitFilesInFolder.mustExitNow = callback(folderPath, currName, ROOT,
            currCreationTime, currModificationTime);
        fileTypes.splice(fileTypes.indexOf(ROOT), 1);
    }
    const srcDir = Fs.opendirSync(folderPath);
    while ((currDirEntity = srcDir.readSync())) {
        if (visitFilesInFolder.mustExitNow) {
            break;
        }
        currName = currDirEntity.name;
        currSrcPath = Path.resolve(folderPath, currName);
        currStats = Fs.lstatSync(currSrcPath);
        currCreationTime = currStats.ctimeMs;
        currModificationTime = currStats.mtimeMs;
        if (currDirEntity.isFile()) {
            currExtension = Path.extname(currName).replace(/^\./, '');
            if (fileTypes.includes(currExtension)) {
                visitFilesInFolder.mustExitNow = callback(currSrcPath, currName, currExtension,
                    currCreationTime, currModificationTime);
            } else {
                if (!visitFilesInFolder.skippedEntries) {
                    visitFilesInFolder.skippedEntries = [];
                }
                visitFilesInFolder.skippedEntries.push (currSrcPath);
            }
        } else if (currDirEntity.isDirectory()) {
            if (fileTypes.includes(DIR)) {
                visitFilesInFolder.mustExitNow = callback(currSrcPath, currName, DIR,
                    currCreationTime, currModificationTime);
            }
            visitFilesInFolder(currSrcPath, fileTypes, callback);
        }
    }
    srcDir.closeSync();
    return (visitFilesInFolder.skippedEntries || null);
}
exports.visitFilesInFolder = visitFilesInFolder;

/**
 * Reads and returns the trimmed first non-empty line in a given text file, given that the line does not start with any
 * of the strings in `skipSignatures`. Also, the value returned will not contain any of the strings in `removals`. If
 * after stripping off all removals and trimming the line is left blank, the next line is tried, and so forth.
 *
 * @param filePath {string}
 * @param skipSignatures {string[]}
 * @param removals {string[]}
 */
const getDocumentHeader = function (filePath, skipSignatures, removals = []) {
    const purgeLine = function (lineStr) {
        // @type {string}
        const $ = {"lineStr": lineStr};

        // Exit if line is empty or only has spaces.
        if (!($.lineStr || '').trim()) {
            return null;
        }

        // Exit if line starts with any of the skip signatures.
        $.mustSkip = false;
        skipSignatures.forEach(function (skipSignature) {
            if (!$.mustSkip && $.lineStr.indexOf(skipSignature) == 0) {
                $.mustSkip = true;
            }
        });
        if ($.mustSkip) {
            return null;
        }

        // Take off all removals; if after this purging the line is left empty, exit.
        removals.forEach(function (strToRemove) {
            while ($.lineStr.indexOf(strToRemove) != -1) {
                $.lineStr = $.lineStr.replace(strToRemove, '');
            }
        });
        if (!$.lineStr) {
            return null;
        }

        // If we reach here, the line is legit.
        return $.lineStr;
    };
    const reader = new LineByLine(filePath);
    let lineBuffer = null;
    let line = null;
    while ((lineBuffer = reader.next())) {
        line = purgeLine(lineBuffer.toString('utf-8'));
        if (line) {
            break;
        }
    }
    return line;
}
exports.getDocumentHeader = getDocumentHeader;