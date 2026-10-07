// ==UserScript==
// @name         江西省县域医共体 - 自动诊断候选
// @namespace    local.jiangxi.radiation
// @version      {{SCRIPT_VERSION}}
// @updateURL   https://raw.githubusercontent.com/kongji1/jiangxi-radiation-auto-diagnose/main/jiangxi-radiation-auto-diagnose.user.js
// @downloadURL https://raw.githubusercontent.com/kongji1/jiangxi-radiation-auto-diagnose/main/jiangxi-radiation-auto-diagnose.user.js
// @description  以页面实时推送为主、轻量协议探测为兜底，按可配置规则识别后优先通过系统协议进入诊断；支持可控开发者诊断日志。
// @match        http://10.10.94.90:22112/*
// @match        http://10.10.94.90:22100/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      raw.githubusercontent.com
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

