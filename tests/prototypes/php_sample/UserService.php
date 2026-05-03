<?php

// PHP service fixture responsible for user creation flow.

class UserService
{
    public function create(string $name): string
    {
        return $name . '-created';
    }
}