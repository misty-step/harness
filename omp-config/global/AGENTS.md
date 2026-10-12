<!-- shared guidance: agent-config -->

## OMP workstation

Edit harness source, not the composed global instructions under `omp config path`.
For OMP work records or host privileges, read `$(omp config path)/OPERATIONS.md`.

Engineers cannot access the operator's display. Web QA uses the native headless `browser`.
Native GUI QA runs the app and screenshot/input commands together under `omp-gui -- sh`
on private Xvfb; inspect the image before choosing clicks. Do not attach host display or browser sockets.
Cold pass/signing requests fail without pinentry; ask the operator to unlock outside the cage, then retry.
Herdr reads and own-pane lifecycle reports work; host commands, input and cross-pane mutations do not.
Use Pulse clients (`parecord`, `paplay`); native PipeWire/ALSA cannot reach the host graph.
