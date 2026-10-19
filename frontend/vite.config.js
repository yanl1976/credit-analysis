import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // 基础库与业务代码分离：第三方库单独成块，便于浏览器长期缓存，
        // 业务代码变更时无需让用户重新下载整包（原先 element-plus 全量打进主包）
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](element-plus|@element-plus)[\\/]/.test(id)) return 'element-plus';
          if (/[\\/]node_modules[\\/](echarts|zrender)[\\/]/.test(id)) return 'echarts';
          return 'vendor';
        },
      },
    },
  },
});
