import { renderShell } from '../lib/shell.js';

renderShell('nutrition', '../');
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  document.querySelector('#main').focus();
});
