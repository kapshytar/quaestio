(function (global) {
  var fallbackConfig = {
    sseDataPrefix: "data:",
    doneTokens: ["[DONE]"],
    modelPaths: ["model", "modelVersion"],
    deltaTextPaths: [
      "choices[0].delta.content",
      "choices[0].delta.text",
      "choices[0].text",
      "choices[0].message.content",
      "delta.text",
      "delta.content"
    ],
    finalTextPaths: [
      "choices[0].message.content",
      "choices[0].delta.content",
      "choices[0].delta.text",
      "choices[0].text",
      "delta.text",
      "delta.content",
      "content[0].text",
      "candidates[0].content.parts[0].text"
    ]
  };

  function parseConfig(configJson) {
    if (!configJson) return fallbackConfig;
    try {
      return Object.assign({}, fallbackConfig, JSON.parse(String(configJson)));
    } catch (_) {
      return fallbackConfig;
    }
  }

  function parsePath(path) {
    return String(path).split(".").map(function (segment) {
      var open = segment.indexOf("[");
      var close = segment.indexOf("]");
      if (open >= 0 && close > open) {
        var key = segment.slice(0, open);
        var index = parseInt(segment.slice(open + 1, close), 10);
        return { key: key, index: Number.isNaN(index) ? null : index };
      }
      return { key: segment, index: null };
    });
  }

  function valueAt(root, path) {
    var current = root;
    for (var i = 0; i < path.length; i += 1) {
      var component = path[i];
      if (current == null) return null;
      if (component.key) {
        if (typeof current !== "object" || Array.isArray(current)) return null;
        current = current[component.key];
      }
      if (component.index != null) {
        if (!Array.isArray(current) || component.index < 0 || component.index >= current.length) {
          return null;
        }
        current = current[component.index];
      }
    }
    return current;
  }

  function collapseToString(value) {
    if (value == null) return null;
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
      return value.map(collapseToString).filter(Boolean).join("");
    }
    if (typeof value === "object") {
      return collapseToString(value.text) || collapseToString(value.content);
    }
    return null;
  }

  function firstString(root, paths, options) {
    var trim = !options || options.trim !== false;
    for (var i = 0; i < paths.length; i += 1) {
      var value = valueAt(root, parsePath(paths[i]));
      var text = collapseToString(value);
      if (text == null) continue;
      var stringValue = String(text);
      if (trim) {
        var trimmed = stringValue.trim();
        if (trimmed) return trimmed;
      } else if (stringValue.length > 0) {
        return stringValue;
      }
    }
    return null;
  }

  global.parseMergeSsePayload = function (rawLine, configJson) {
    var config = parseConfig(configJson);
    var line = String(rawLine || "").trim();
    if (!line || line.indexOf(config.sseDataPrefix) !== 0) return null;
    var payload = line.slice(config.sseDataPrefix.length).trim();
    if (!payload || config.doneTokens.indexOf(payload) !== -1) return null;
    try {
      JSON.parse(payload);
      return payload;
    } catch (_) {
      return null;
    }
  };

  global.parseMergeChunk = function (jsonText, configJson) {
    var config = parseConfig(configJson);
    var object = typeof jsonText === "string" ? JSON.parse(jsonText) : jsonText;
    return JSON.stringify({
      deltaText: firstString(object, config.deltaTextPaths, { trim: false }) || "",
      modelUsed: firstString(object, config.modelPaths, { trim: true })
    });
  };

  global.extractMergeFinalText = function (jsonText, fallback, configJson) {
    var config = parseConfig(configJson);
    var object = typeof jsonText === "string" ? JSON.parse(jsonText) : jsonText;
    return firstString(object, config.finalTextPaths, { trim: false }) || String(fallback || "");
  };
})(this);
