// content.js
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'DOMAIN_MATCH') {
    alert(`Domain ${message.domain} is in tracking list!`);
  }
});
