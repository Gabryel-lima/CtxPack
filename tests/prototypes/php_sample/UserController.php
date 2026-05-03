<?php

// PHP controller fixture that coordinates request handling.

require_once __DIR__ . '/UserService.php';

class UserController
{
    public function handleCreate(string $name): string
    {
        $service = new UserService();
        return $service->create($name);
    }
}