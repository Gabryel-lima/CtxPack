// C# controller fixture coordinating service calls.

using Fixtures.Services;

namespace Fixtures.Controllers
{
    public class UserController
    {
        private readonly UserService service = new UserService();

        public string HandleCreate(string name)
        {
            return service.Create(name);
        }
    }
}