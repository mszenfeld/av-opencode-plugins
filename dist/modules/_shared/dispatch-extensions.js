let registered = {};
function registerDispatchExtensions(extensions) {
  registered = { ...registered, ...extensions };
}
function getDispatchExtensions() {
  return registered;
}
function clearDispatchExtensions() {
  registered = {};
}
export {
  clearDispatchExtensions,
  getDispatchExtensions,
  registerDispatchExtensions
};
