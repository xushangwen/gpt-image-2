# 响应式规则

## 断点体系
- Desktop baseline：1440px（desktop-first 向下缩）
- 断点：mobile ≤ 768px / iPad 769–1024px / Desktop > 1024px

## CSS 原则
- 文字溢出优先用 `clamp()` 或 `vw`，禁止用 `overflow:hidden` / z-index hack
- full-width 容器 + 内容限宽：用 padding 约束文字，不给容器加 max-width
- 验证断点级联方向：更宽屏幕对应更宽布局，不得反转

## 修改前确认
- 样式改动前先输出：目标选择器、当前值、将改成什么，等确认再写代码
- CSS 修改默认只作用于当前组件，不污染全局，除非明确要求
