export default class Chart {
  constructor(_canvas, config = {}) {
    this.data = config?.data ?? { labels: [], datasets: [] };
    this.options = config?.options ?? {};
  }
  update() {}
  destroy() {}
}
