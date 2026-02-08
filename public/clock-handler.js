/**
 * BREWHUB CLOCK IN/OUT - HARDENED HANDLER
 * Ensure this file is in /public/ alongside portal.html
 */
(function () {
  'use strict';

  window.addEventListener('load', function () {
    document.getElementById('clock-in-btn').addEventListener('click', function () {
      document.getElementById('clock-status').textContent = 'clock-in';
    });
  });
})();