/**
 *
 * @param   mtEngine {MetaTextEngine}
 *          Instance of the MetaTextEngine class. It holds an index of all files and folders in the
 *          compilation as well as other useful data, and allows us to obtain document-specific
 *          information easily.
 */
module.exports = function HtmlTemplateProcessor(mtEngine) {

    // Import constants
    const {
        ROOT_NAME_TAG,
        DOC_NAME_TAG,
        ROOT_DIR_TAG,
        NAVIGATION_TAG,
        DOCUMENT_TAG,
        LAST_UPDATED_TAG
    } = require('./constants');

    /**
     * Escapes given `p_pattern` so that it can be used as source for creating a RegExp Object.
     * @param   p_pattern
     *          The string to be escaped for conversion to RegExp.
     *
     * @return  {string}
     *          The escaped string
     * @private
     */
    function _escapePattern(p_pattern) {
        return p_pattern.replace(/(\$|\]|\[|\{|\}|\(|\)|\*|\+|\?|\.|\\)/g, '\\$1');
    }

    /**
     * Populates given template with given data, resolving placeholder to context-sensitive information,
     * e.g., adjusting the links in the generated navigation tree to the location of the current document.
     *
     * @param srcFilePath
     * @param syntaxTree
     * @param fileContent
     * @param htmlTemplate
     * @param optionsData
     * @return {string}
     */
    this.process = function (srcFilePath, syntaxTree, fileContent, htmlTemplate, optionsData) {
        let output = htmlTemplate;
        const tagsToResolve = [ROOT_NAME_TAG, DOC_NAME_TAG, LAST_UPDATED_TAG, NAVIGATION_TAG,
            DOCUMENT_TAG, ROOT_DIR_TAG, LAST_UPDATED_TAG];
        tagsToResolve.forEach (function (tag) {
            const tagPattern = new RegExp (_escapePattern (tag), 'g');
            switch (tag) {

                case ROOT_NAME_TAG:
                    output = output.replace (tagPattern, mtEngine.getCompilationHeader());
                    break;

                case DOC_NAME_TAG:
                    output = output.replace (tagPattern, mtEngine.getHeaderFor (srcFilePath));
                    break;

                case NAVIGATION_TAG:
                    output = output.replace (tagPattern, mtEngine.getHtmlNavigationFor (srcFilePath));
                    break;

                case LAST_UPDATED_TAG:
                    output = output.replace (tagPattern, mtEngine.getTimeStampFor (srcFilePath));
                    break;

                case DOCUMENT_TAG:
                    // NOTE: because `$` is treated as a special character by String.replace, we cannot use
                    // `replace()` here, or we would destroy any placeholders that the document might carry.
                    output = output.split (tagPattern).join (fileContent);
                    break;

                // Only the $$rootDir$$ can be placed in the document body as well.
                case ROOT_DIR_TAG:
                    const rootRelativePrefix = mtEngine.getRootDirPathFor (srcFilePath);
                    output = output.replace (tagPattern, rootRelativePrefix);
                    break;
            }
        });


        return output;
    }
}