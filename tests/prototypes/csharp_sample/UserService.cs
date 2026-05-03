// C# service fixture covering class and method extraction.

namespace Fixtures.Services
{
    public class UserService
    {
        public string Create(string name)
        {
            return $"{name}-created";
        }
    }
}