var fs = require('fs');

var jade           = require('jade');
var through        = require('through');
var transformTools = require('browserify-transform-tools');

var SourceMapGenerator = require('source-map').SourceMapGenerator;
var convert   = require('convert-source-map');

var PREFIX = "var jade = require('jade/lib/runtime.js');\nmodule.exports=";

var defaultJadeOptions = {
  path: __dirname,
  compileDebug: true,
  pretty: true,
};

function getTransformFn(options) {
  var key;
  var opts = {};
  for(key in defaultJadeOptions) {
    opts[key] = defaultJadeOptions[key];
  }

  options = options || {};
  for(key in options) {
    opts[key] = options[key];
  }

  return function (file) {
    if (!/\.(pug|jade)$/.test(file)) return through();

    var data = '';
    return through(write, end);

    function write (buf) {
      data += buf;
    }
    function end () {
      var _this = this;
      configData = transformTools.loadTransformConfig('browserify-jade', file, {fromSourceFileDir: true}, function(err, configData) {
        if(configData) {
          var config = configData.config || {};
          for(key in config) {
            opts[key] = config[key];
          }
        }

        try {
          var result = compile(file, data, opts);
          result.dependencies.forEach(function(dep) {
            _this.emit('file', dep);
          });
          _this.queue(result.body);
        } catch (e) {
          _this.emit("error", e);
        }
        _this.queue(null);
      });
    }
  };
}

module.exports = getTransformFn();
module.exports.jade = getTransformFn;
module.exports.root = null;
module.exports.register = register;

function register() {
  require.extensions['.pug'] = require.extensions['.jade'] = function(module, filename) {
    var result = compile(filename, fs.readFileSync(filename, 'utf-8'), {compileDebug: true});
    return module._compile(result.body, filename);
  };
}

function replaceMatchWith(match, newContent)
{
  var src = match.input;
  return src.slice(0, match.index) + newContent + src.slice(match.index + match[0].length);
}

function withSourceMap(src, compiled, name) {

  var compiledLines = compiled.split('\n');
  var generator = new SourceMapGenerator({file: name + '.js'});

  compiledLines.forEach(function(l, lineno) {
    var oldFormat = false;
    var generatedLine;
    var linesMatched = {};

    var m = l.match(/^jade(_|\.)debug\.unshift\(new jade\.DebugItem\( ([0-9]+)/);
    // Check for older jade debug line format
    if (!m) {
      m = l.match(/^(pug|jade)(_|\.)debug\.unshift\(\{ lineno: ([0-9]+)/);
      oldFormat = !!m;
    }
    if (m) {
      var originalLine = Number(m[2]);

      if (originalLine > 0) {

        if (!linesMatched[originalLine] &&
          (!/^jade_debug/.test(compiledLines[lineno+1]) || oldFormat))
            generatedLine = lineno + 3; // 1-based and allow for PREFIX extra line

        if (generatedLine) {

          linesMatched[originalLine] = true;

          generator.addMapping({
            generated: {
              line: generatedLine,
              column: 0
            },
            source: name,
            original: {
              line: originalLine,
              column: 0
            }
          });
        }
      }
    }

    var debugRe = /(pug|jade)(_|\.)debug\.(shift|unshift)\([^;]*\);/;
    var match;
    while(match = l.match(debugRe)) {
      l = replaceMatchWith(match, '');
    }
    compiledLines[lineno] =l;
  });

  // Remove jade debug lines at beginning and end of compiled version
  if (/var jade_debug = /.test(compiledLines[1])) compiledLines[1] = '';
  if (/try \{/.test(compiledLines[2])) compiledLines[2] = '';
  var ln = compiledLines.length;
  if (/\} catch \(err\) \{/.test(compiledLines[ln-4])) {
    compiledLines[ln-2] = compiledLines[ln-3] = compiledLines[ln-4] = '';
  }

  generator.setSourceContent(name, src);

  var map = convert.fromJSON(generator.toString());
  compiledLines.push(map.toComment());
  return compiledLines.join('\n');
}

function compile(file, template, options) {
    options.filename= file;
    var result;
    if (jade.compileClientWithDependenciesTracked) {
      result = jade.compileClientWithDependenciesTracked(template, options);
    } else if (jade.compileClient) {
      result = {
        body: jade.compileClient(template, options).toString(),
        dependencies: []
      };
    } else {
      // jade < 1.0
      options.client = true;
      result = {
        body: jade.compile(template, options).toString(),
        dependencies: []
      };
    }
    if (options.compileDebug)
      result.body = withSourceMap(template, result.body, file);

    result.body = PREFIX + result.body;
    return result;
}
