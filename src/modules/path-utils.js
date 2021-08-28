'use strict';
const Path = require('path');

/**
 * Swaps given fileName's existing extension for a new one.
 * @param   fileName {string}
 *          The original file name.
 *
 * @param   {string} newExtension
 *          The new extension to apply. If empty, it causes the existing extension to be removed.
 */
const changeFileExtension = function (fileName, newExtension) {
    return getFileName(fileName, true) + (newExtension? ('.' + newExtension) : '');
}
exports.changeFileExtension = changeFileExtension;

/**
 * Returns only the file name portion of given `path`, optionally also removing the extension. Note: if the path points
 * to a folder, the most deeply nested foldername is returned (i.e., the last segment).
 * @param   pathString
 *          @type String
 *          The path to extract the filename from.
 *
 * @param   trimExtension
 *          @type boolean
 *          Whether to also remove file extension
 */
const getFileName = function (pathString, trimExtension) {
    return Path.basename(pathString, trimExtension? Path.extname(pathString) : '');
}
exports.getFileName = getFileName;

/**
 * Returns the path to the directory where the given file or folder path resides.
 */
const getParentPath = function (path) {
    return Path.dirname(path);
}
exports.getParentPath = getParentPath;

/**
 * Returns the path to the directory where the code calling the program currently runs.
 */
const getCurrentDir = function () {
    return process.cwd();
};
exports.getScriptHome = getCurrentDir;

/**
 * Returns `true` if given path starts at the root of the file system (or at the root of a drive in Windows), or
 * `false` otherwise.
 * @param   pathString
 *          @type String
 *          A path to check.
 *
 * @returns {boolean}
 *          `True` if path starts at the root of file system (or a drive, in Windows).
 */
const isAbsolutePath = function (pathString) {
    return Path.normalize(pathString + '/') === Path.normalize(Path.resolve(pathString) + '/');
}
exports.isAbsolutePath = isAbsolutePath;

/**
 *
 * Produces an absolute file URI out of the provided file path, resolving it against the currently working
 * directory if needed.
 *
 * @param   filePath
 *          @type String
 *          A file path, as a String; can be an absolute file URI already (will be passed through) or a
 *          relative path, which will be resolved against the directory this script runs from.
 *
 * @param   errorCallback
 *          Function to pass descriptive error messages. It should take one string argument.
 *
 * @param   customErrMessage
 *          @type String
 *          A custom prefix for the message being passed to `errorCallback`.
 * @returns
 *          an absolute path, or `null` on error..
 */
exports.ensureAbsUri = function (filePath, errorCallback, customErrMessage) {
    const defaultError = 'Invalid URI:'
    if (!filePath) {
        errorCallback((customErrMessage || defaultError) + ' ' + filePath);
        return null;
    }
    let absolutePath = filePath;
    if (!isAbsolutePath(filePath)) {
        try {
            absolutePath = Path.resolve(getCurrentDir(), filePath);
        } catch (e) {
            errorCallback((customErrMessage || defaultError) + ' ' + e + ' Path given: ' + filePath);
        }
    }
    return absolutePath;
}