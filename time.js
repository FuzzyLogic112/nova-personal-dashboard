(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NovaTime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // This personal workspace uses Beijing time, independently of the browser's zone.
  const zone = "Asia/Shanghai";
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  const pad = (value) => String(value).padStart(2, "0");
  function parts(value = new Date()) {
    const date = new Date(value);
    const fields = Object.fromEntries(formatter.formatToParts(date)
      .filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
    fields.weekday = new Date(Date.UTC(fields.year, fields.month - 1, fields.day)).getUTCDay();
    return fields;
  }
  function dateKey(value = new Date()) {
    const { year, month, day } = parts(value);
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  function format(value, options) {
    return new Date(value).toLocaleString("zh-CN", { ...options, timeZone: zone, hourCycle: "h23" });
  }
  function toInput(value) {
    if (!value || !Number.isFinite(new Date(value).getTime())) return "";
    const { hour, minute } = parts(value);
    return `${dateKey(value)}T${pad(hour)}:${pad(minute)}`;
  }
  function fromInput(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
    // datetime-local has no offset; the form explicitly labels its values as Beijing time.
    const date = new Date(`${value}+08:00`);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  return { zone, parts, dateKey, format, toInput, fromInput };
});
