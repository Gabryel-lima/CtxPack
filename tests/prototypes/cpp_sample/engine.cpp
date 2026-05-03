// Engine implementation fixture that exercises C++ function extraction.

#include "engine.h"

Engine::Engine() {
}

void Engine::renderFrame(int frameIndex) {
    buildFrame(frameIndex);
}

int buildFrame(int frameIndex) {
    return frameIndex + 1;
}